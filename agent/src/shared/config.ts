import "dotenv/config";
import { ethers } from "ethers";

const network = process.env.NETWORK || "local";

const rpcUrl =
  network === "local"
    ? process.env.LOCAL_RPC_URL || "http://127.0.0.1:8545"
    : process.env.SEPOLIA_RPC_URL!;

export const provider = new ethers.JsonRpcProvider(rpcUrl, undefined, {
  cacheTimeout: -1,
});

export function getWallet(envKey: string): ethers.Wallet {
  return new ethers.Wallet(process.env[envKey]!, provider);
}

export const addresses = {
  treasury: process.env.TREASURY_ADDRESS!,
  identityRegistry: process.env.IDENTITY_REGISTRY!,
  reputationRegistry: process.env.REPUTATION_REGISTRY!,
  validationRegistry: process.env.VALIDATION_REGISTRY!,
  acpContract: process.env.ACP_CONTRACT!,
  hookContract: process.env.HOOK_CONTRACT!,
  tokenContract: process.env.TOKEN_CONTRACT!,
};
