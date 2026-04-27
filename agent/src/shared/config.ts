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
  didRegistry: process.env.DID_REGISTRY!,
  didRegistrar: process.env.DID_REGISTRAR!,
  inviteRegistrar: process.env.INVITE_REGISTRAR!,
  identityRegistry: process.env.IDENTITY_REGISTRY!,
  reputationRegistry: process.env.REPUTATION_REGISTRY!,
  validationRegistry: process.env.VALIDATION_REGISTRY!,
};

export const PROVIDER_PORT = parseInt(process.env.PROVIDER_PORT || "4021");
export const INVITE_SERVICE_URL = process.env.INVITE_SERVICE_URL || "http://127.0.0.1:4060";

// x402 payment config
export const X402_ENABLED = process.env.X402_ENABLED !== "false";
export const USDC_PRICE_PER_IMAGE = parseFloat(process.env.USDC_PRICE_PER_IMAGE || "0.05");
export const USDC_ADDRESS = process.env.USDC_ADDRESS!; // ERC-3009 token address (MockERC3009 on Anvil)
// EIP-712 domain for the ERC-3009 token. Defaults match MockERC3009.sol;
// override for real USDC (name="USD Coin", version="2").
export const USDC_NAME = process.env.USDC_NAME || "MockERC3009";
export const USDC_VERSION = process.env.USDC_VERSION || "1";
export const USDC_DECIMALS = parseInt(process.env.USDC_DECIMALS || "6");
// Empty = use the in-process x402Facilitator (default). Set to a public
// facilitator URL (e.g. https://x402.org/facilitator) to delegate verify/settle.
export const X402_FACILITATOR_URL = process.env.X402_FACILITATOR_URL || "";
export const RPC_URL = rpcUrl;

/** Convert uint128 hex to did:codatta:<uuid> format */
export function hexToDidUri(hex: string): string {
  const h = hex.replace(/^0x/, "").padStart(32, "0");
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`;
  return `did:codatta:${uuid}`;
}
