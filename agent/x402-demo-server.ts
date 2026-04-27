/**
 * Standalone x402 demo server. Keeps running until Ctrl+C.
 * Usage: npx tsx x402-demo-server.ts
 */
import { ethers } from "ethers";
import express from "express";
import { createX402Middleware, type X402Config } from "./src/shared/x402.js";

const TOKEN = (process.env.TOKEN || "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318") as `0x${string}`; // MockERC3009
const RPC = "http://127.0.0.1:8545";
const PORT = 4099;

const provider = new ethers.JsonRpcProvider(RPC);
const providerWallet = new ethers.Wallet(
  "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  provider,
);

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
app.post("/annotate", (req, res) => {
  console.log("[server] paid request — body:", req.body);
  res.json({ ok: true, result: "mock-annotation", echo: req.body });
});

app.listen(PORT, () => {
  console.log(`\n[server] listening on http://127.0.0.1:${PORT}`);
  console.log(`[server] payTo = ${providerWallet.address}`);
  console.log(`[server] asset = ${TOKEN}`);
  console.log(`\nTry:`);
  console.log(`  curl -sX POST http://127.0.0.1:${PORT}/annotate -H 'content-type: application/json' -d '{}'`);
  console.log(`  npx tsx x402-demo-pay.ts`);
});
