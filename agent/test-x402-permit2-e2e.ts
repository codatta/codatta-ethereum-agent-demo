/**
 * End-to-end test for the Permit2 transfer path of the x402 exact scheme.
 *
 * Unlike test-x402-e2e.ts (which uses an EIP-3009 token), this test uses a
 * plain ERC-20 (MockERC20) and routes the transfer through Permit2 +
 * x402ExactPermit2Proxy. The exact-scheme client SDK auto-detects this via
 * `requirements.extra.assetTransferMethod = "permit2"`.
 *
 * Bootstrapping note:
 *   Anvil starts empty, so neither the canonical Permit2 contract
 *   (0x000000000022D473030F116dDEE9F6B43aC78BA3) nor the x402ExactPermit2Proxy
 *   (0x402085c248EeA27D92E8b30b2C58ed07f9E20001) exist there. We mirror their
 *   on-chain bytecode from Base Sepolia via `anvil_setCode` once at startup.
 *   This is faster and more predictable than re-deploying through the
 *   Arachnid CREATE2 deployer.
 *
 * Prerequisites:
 *   - Anvil running on 127.0.0.1:8545 (chainId 31337)
 *   - Foundry artifacts built (`forge build`) so MockERC20.sol bytecode is on disk
 *   - Outbound network access to https://sepolia.base.org (used only at startup
 *     to fetch Permit2 + proxy bytecode; can be overridden via PERMIT2_SOURCE_RPC)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { ethers } from "ethers";
import express from "express";
import { createX402Middleware, wrapFetchWithX402, type X402Config } from "./src/shared/x402.js";

const RPC = "http://127.0.0.1:8545";
const PORT = 4098;
const PRICE_USD = 0.05;
const TOKEN_DECIMALS = 6;
const PERMIT2_SOURCE_RPC = process.env.PERMIT2_SOURCE_RPC || "https://sepolia.base.org";

const PERMIT2_ADDRESS = "0x000000000022D473030F116dDEE9F6B43aC78BA3";
const X402_EXACT_PERMIT2_PROXY = "0x402085c248EeA27D92E8b30b2C58ed07f9E20001";

const provider = new ethers.JsonRpcProvider(RPC);
// Anvil account #2 — provider, receives payment.
const providerWallet = new ethers.Wallet(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  provider,
);
// Anvil account #1 — client, pays.
const clientWallet = new ethers.Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  provider,
);
// Anvil account #0 — deployer/funder for the test ERC-20.
const deployerWallet = new ethers.Wallet(
  "0xac0974bec39a17e36ba4a6b4d238ff944bacb478cbed5efcae784d7bf4f2ff80",
  provider,
);

async function rpcCall(url: string, method: string, params: unknown[]): Promise<unknown> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  const json = (await res.json()) as { result?: unknown; error?: { message: string } };
  if (json.error) throw new Error(`${method} via ${url}: ${json.error.message}`);
  return json.result;
}

async function ensureCode(addr: string): Promise<void> {
  const local = (await rpcCall(RPC, "eth_getCode", [addr, "latest"])) as string;
  if (local && local !== "0x") return;
  console.log(`[bootstrap] ${addr} has no code on Anvil; fetching from ${PERMIT2_SOURCE_RPC}…`);
  const remote = (await rpcCall(PERMIT2_SOURCE_RPC, "eth_getCode", [addr, "latest"])) as string;
  if (!remote || remote === "0x") {
    throw new Error(`Source RPC ${PERMIT2_SOURCE_RPC} has no code at ${addr}`);
  }
  await rpcCall(RPC, "anvil_setCode", [addr, remote]);
  const verify = (await rpcCall(RPC, "eth_getCode", [addr, "latest"])) as string;
  if (!verify || verify === "0x") throw new Error(`anvil_setCode did not stick at ${addr}`);
  console.log(`[bootstrap] installed ${remote.length / 2 - 1} bytes at ${addr}`);
}

interface MockERC20Artifact {
  abi: ethers.InterfaceAbi;
  bytecode: { object: string };
}

function loadMockERC20Artifact(): MockERC20Artifact {
  // Foundry writes artifacts under <repo-root>/out/. Climb out of agent/.
  const artifactPath = path.resolve(
    new URL(import.meta.url).pathname,
    "../../out/MockERC20.sol/MockERC20.json",
  );
  return JSON.parse(readFileSync(artifactPath, "utf8")) as MockERC20Artifact;
}

async function deployMockToken(): Promise<ethers.Contract> {
  const artifact = loadMockERC20Artifact();
  const factory = new ethers.ContractFactory(artifact.abi, artifact.bytecode.object, deployerWallet);
  const contract = await factory.deploy("PermitDemo USD", "pdUSD");
  await contract.waitForDeployment();
  const addr = await contract.getAddress();
  console.log(`[bootstrap] MockERC20 deployed at ${addr}`);
  return new ethers.Contract(addr, artifact.abi, deployerWallet);
}

async function balance(token: ethers.Contract, addr: string): Promise<number> {
  const raw: bigint = await token.balanceOf(addr);
  return Number(ethers.formatUnits(raw, TOKEN_DECIMALS));
}

async function main() {
  // Step 1 — install Permit2 + x402ExactPermit2Proxy bytecode on Anvil.
  await ensureCode(PERMIT2_ADDRESS);
  await ensureCode(X402_EXACT_PERMIT2_PROXY);

  // Step 2 — deploy a fresh non-EIP-3009 ERC-20 and mint to the client wallet.
  const token = await deployMockToken();
  const tokenAddress = (await token.getAddress()) as `0x${string}`;
  const mintAmount = ethers.parseUnits("100", TOKEN_DECIMALS); // way more than needed
  await (await token.mint(clientWallet.address, mintAmount)).wait();

  // Sanity: client must NOT have any Permit2 allowance yet — we want the wrapper
  // to actually exercise the approve path. (Each test run is a fresh deploy, so
  // this is true by construction.)
  const allowance: bigint = await new ethers.Contract(
    tokenAddress,
    ["function allowance(address,address) view returns (uint256)"],
    provider,
  ).allowance(clientWallet.address, PERMIT2_ADDRESS);
  if (allowance !== 0n) {
    throw new Error(`expected zero pre-existing Permit2 allowance, got ${allowance}`);
  }

  const net = await provider.getNetwork();
  const config: X402Config = {
    enabled: true,
    priceUsd: PRICE_USD,
    payTo: providerWallet.address,
    chainId: Number(net.chainId),
    rpcUrl: RPC,
    tokenAddress,
    // Name/version are unused in permit2 mode but required by the interface.
    tokenName: "PermitDemo USD",
    tokenVersion: "1",
    tokenDecimals: TOKEN_DECIMALS,
    routePath: "/permit2-annotate",
    transferMethod: "permit2",
  };

  const app = express();
  app.use(express.json());
  app.use(createX402Middleware(config, providerWallet));
  app.post("/permit2-annotate", (_req, res) => {
    console.log("[server] handler invoked — payment verified, returning result");
    res.json({ ok: true, result: "permit2-annotated" });
  });
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 800));
  console.log(`[test] server listening on :${PORT}`);

  const before = {
    provider: await balance(token, providerWallet.address),
    client: await balance(token, clientWallet.address),
  };
  console.log("[test] balances before:", before);

  const x402Fetch = wrapFetchWithX402(clientWallet, config);

  console.log("[test] calling POST /permit2-annotate with x402 fetch (permit2 mode)");
  const res = await x402Fetch(`http://127.0.0.1:${PORT}/permit2-annotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images: ["img1"] }),
  });
  console.log("[test] response status:", res.status);
  console.log("[test] response body:", await res.text());

  // Allow facilitator a moment to land settle tx.
  await new Promise((r) => setTimeout(r, 3000));

  const after = {
    provider: await balance(token, providerWallet.address),
    client: await balance(token, clientWallet.address),
  };
  console.log("[test] balances after:", after);
  console.log(
    "[test] delta — provider:",
    +(after.provider - before.provider).toFixed(6),
    "client:",
    +(after.client - before.client).toFixed(6),
  );

  const allowanceAfter: bigint = await new ethers.Contract(
    tokenAddress,
    ["function allowance(address,address) view returns (uint256)"],
    provider,
  ).allowance(clientWallet.address, PERMIT2_ADDRESS);
  console.log("[test] post-run Permit2 allowance:", allowanceAfter.toString());

  const eps = 1e-6;
  const ok =
    res.status === 200 &&
    Math.abs(after.provider - before.provider - PRICE_USD) < eps &&
    Math.abs(before.client - after.client - PRICE_USD) < eps &&
    allowanceAfter > 0n;
  console.log(ok ? "\n✅ PASS" : "\n❌ FAIL");
  server.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[test] error:", err);
  process.exit(1);
});
