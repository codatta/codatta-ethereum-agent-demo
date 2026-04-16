/**
 * CLI helper to set the Agent ID in provider-identity.json.
 *
 * Usage:
 *   npm run set-agent-id <agentId>
 *
 * Verifies on-chain that the agent is owned by the provider's wallet,
 * then writes agentId to provider-identity.json. Restart the provider
 * to pick up the change.
 */
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { provider, addresses } from "../shared/config.js";
import { IdentityRegistryABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("set-agent-id");

const IDENTITY_FILE = path.join(import.meta.dirname, "../../provider-identity.json");

async function main() {
  const arg = process.argv[2];
  if (!arg) {
    console.error("Usage: npm run set-agent-id <agentId>");
    process.exit(1);
  }

  // Load wallet: prefer .env PROVIDER_PRIVATE_KEY, fallback to provider-identity.json
  const envKey = process.env.PROVIDER_PRIVATE_KEY;
  const saved = fs.existsSync(IDENTITY_FILE)
    ? JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf-8"))
    : {};
  const privateKey = envKey || saved.privateKey;
  if (!privateKey) {
    console.error("No private key found. Set PROVIDER_PRIVATE_KEY in .env or run the provider once first.");
    process.exit(1);
  }

  const wallet = new ethers.Wallet(privateKey, provider);
  const agentId = BigInt(arg);

  // Verify ownership on-chain
  const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);
  let owner: string;
  try {
    owner = await identity.ownerOf(agentId);
  } catch (e: any) {
    console.error(`Failed to query ownership: ${e.message}`);
    process.exit(1);
  }

  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    console.error(`Agent ${agentId} is owned by ${owner}, not by this provider's wallet (${wallet.address})`);
    process.exit(1);
  }

  // Update identity file (create if not exists)
  saved.agentId = agentId.toString();
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(saved, null, 2));
  log.info(`Wallet: ${wallet.address}`);

  log.success(`Agent ID set to ${agentId} in provider-identity.json`);
  log.info("Restart the provider for the change to take effect.");
}

main().catch((err) => {
  console.error("[SET-AGENT-ID] Fatal:", err.message);
  process.exit(1);
});
