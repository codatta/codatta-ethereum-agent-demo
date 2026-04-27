/**
 * Focused end-to-end test for the SDK-based x402 integration.
 * Runs server + client in one process. No DID / ERC-8004 / invite service.
 */
import { ethers } from "ethers";
import express from "express";
import { createX402Middleware, wrapFetchWithX402, type X402Config } from "./src/shared/x402.js";

const TOKEN = (process.env.TOKEN || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318") as `0x${string}`;
const RPC = "http://127.0.0.1:8545";
const PORT = 4099;

const provider = new ethers.JsonRpcProvider(RPC);
const providerWallet = new ethers.Wallet(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  provider,
);
const clientWallet = new ethers.Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  provider,
);

const token = new ethers.Contract(
  TOKEN,
  ["function balanceOf(address) view returns (uint256)"],
  provider,
);

async function balance(addr: string): Promise<number> {
  const raw = await token.balanceOf(addr);
  return Number(ethers.formatUnits(raw, 6));
}

async function main() {
  const net = await provider.getNetwork();
  const config: X402Config = {
    enabled: true,
    priceUsd: 0.05,
    payTo: providerWallet.address,
    chainId: Number(net.chainId),
    rpcUrl: RPC,
    tokenAddress: TOKEN as `0x${string}`,
    tokenName: "MockERC3009",
    tokenVersion: "1",
    tokenDecimals: 6,
    routePath: "/annotate",
  };

  const app = express();
  app.use(express.json());
  app.use(createX402Middleware(config, providerWallet));
  app.post("/annotate", (_req, res) => {
    console.log("[server] handler invoked — payment verified, returning result");
    res.json({ ok: true, result: "annotated-mock" });
  });
  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 800));
  console.log(`[test] server listening on :${PORT}`);

  const before = {
    provider: await balance(providerWallet.address),
    client: await balance(clientWallet.address),
  };
  console.log("[test] balances before:", before);

  const x402Fetch = wrapFetchWithX402(clientWallet, config);

  console.log("[test] calling POST /annotate with x402 fetch");
  const res = await x402Fetch(`http://127.0.0.1:${PORT}/annotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images: ["img1"] }),
  });
  console.log("[test] response status:", res.status);
  console.log("[test] response body:", await res.text());

  // Give facilitator a moment to land the settlement tx
  await new Promise((r) => setTimeout(r, 3000));

  const after = {
    provider: await balance(providerWallet.address),
    client: await balance(clientWallet.address),
  };
  console.log("[test] balances after:", after);
  console.log(
    "[test] delta — provider:",
    +(after.provider - before.provider).toFixed(6),
    "client:",
    +(after.client - before.client).toFixed(6),
  );

  const eps = 1e-6;
  const ok =
    res.status === 200 &&
    Math.abs(after.provider - before.provider - 0.05) < eps &&
    Math.abs(before.client - after.client - 0.05) < eps;
  console.log(ok ? "\n✅ PASS" : "\n❌ FAIL");
  server.close();
  process.exit(ok ? 0 : 1);
}

main().catch((err) => {
  console.error("[test] error:", err);
  process.exit(1);
});
