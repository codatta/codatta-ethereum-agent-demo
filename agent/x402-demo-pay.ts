/**
 * Client-side x402 pay demo. Calls the running server once with auto-payment.
 * Usage: npx tsx x402-demo-pay.ts
 */
import { ethers } from "ethers";
import { wrapFetchWithX402, type X402Config } from "./src/shared/x402.js";

const TOKEN = (process.env.TOKEN || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318") as `0x${string}`;
const RPC = "http://127.0.0.1:8545";
const URL = "http://127.0.0.1:4099/annotate";

const provider = new ethers.JsonRpcProvider(RPC);
const clientWallet = new ethers.Wallet(
  "0x59c6995e998f97a5a0044966f0945389dc9e86dae88c7a8412f4603b6b78690d",
  provider,
);

const token = new ethers.Contract(TOKEN, ["function balanceOf(address) view returns (uint256)"], provider);
const bal = async (addr: string) => Number(ethers.formatUnits(await token.balanceOf(addr), 6));

const net = await provider.getNetwork();
const config: X402Config = {
  enabled: true,
  priceUsd: 0.05,
  payTo: "0x0000000000000000000000000000000000000000", // server overrides in 402 response
  chainId: Number(net.chainId),
  rpcUrl: RPC,
  tokenAddress: TOKEN as `0x${string}`,
  tokenName: "MockERC3009",
  tokenVersion: "1",
  tokenDecimals: 6,
};

const before = await bal(clientWallet.address);
console.log(`[pay] client ${clientWallet.address}`);
console.log(`[pay] balance before: ${before} USDC`);

const x402Fetch = wrapFetchWithX402(clientWallet, config);
const res = await x402Fetch(URL, {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({ images: ["img1"] }),
});

console.log(`[pay] status: ${res.status}`);
console.log(`[pay] body: ${await res.text()}`);

// Wait for settlement tx to land
await new Promise((r) => setTimeout(r, 2500));
const after = await bal(clientWallet.address);
console.log(`[pay] balance after: ${after} USDC (delta ${(after - before).toFixed(6)})`);
