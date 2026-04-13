import { ethers } from "ethers";
import { provider, addresses, hexToDidUri } from "../shared/config.js";
import {
  DIDRegistryABI, IdentityRegistryABI,
  ReputationRegistryABI, ValidationRegistryABI,
} from "../shared/abis.js";
import * as log from "../shared/logger.js";
import fs from "fs";
import path from "path";

log.setRole("query");

const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, provider);
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, provider);
const validation = new ethers.Contract(addresses.validationRegistry, ValidationRegistryABI, provider);

const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

// ── Query functions ─────────────────────────────────────────────

async function queryAgentInfo(agentId: bigint) {
  log.step("ERC-8004 Agent Info");

  const owner = await identity.ownerOf(agentId);
  log.info("Agent ID:", agentId.toString());
  log.info("Owner:", owner);

  // Registration file
  const agentURI = await identity.tokenURI(agentId);
  if (agentURI.startsWith("data:application/json;base64,")) {
    const base64 = agentURI.replace("data:application/json;base64,", "");
    const doc = JSON.parse(Buffer.from(base64, "base64").toString());
    log.info("Name:", doc.name);
    log.info("Description:", doc.description);
    log.info("Active:", String(doc.active));
    log.info("x402 Support:", String(doc.x402Support));
    log.info("Supported Trust:", JSON.stringify(doc.supportedTrust));

    if (doc.services) {
      log.info("Services:");
      for (const svc of doc.services) {
        log.info(`  ${svc.name}: ${svc.endpoint}${svc.version ? ` (${svc.version})` : ""}`);
      }
    }

    if (doc.registrations?.length) {
      log.info("Registrations:");
      for (const reg of doc.registrations) {
        log.info(`  agentId=${reg.agentId} @ ${reg.agentRegistry}`);
      }
    }
  } else {
    log.info("Agent URI:", agentURI);
  }

  // Metadata: codatta:did
  try {
    const didBytes = await identity.getMetadata(agentId, "codatta:did");
    const didIdentifier = ethers.AbiCoder.defaultAbiCoder().decode(["uint128"], didBytes)[0];
    log.info("Codatta DID (metadata):", hexToDidUri(didIdentifier.toString(16)));
  } catch {
    log.info("Codatta DID (metadata): not set");
  }
}

async function queryDIDDocument(didIdentifier: bigint) {
  log.step("Codatta DID Document");

  const didDoc = await didRegistry.getDidDocument(didIdentifier);
  const id = didDoc[0];
  const owner = didDoc[1];
  const controllers = didDoc[2];
  const kvAttrs = didDoc[3];
  const arrayAttrs = didDoc[4];

  log.info("DID:", hexToDidUri(id.toString(16)));
  log.info("Owner:", owner);

  if (controllers.length > 0) {
    log.info("Controllers:", controllers.map((c: bigint) => c.toString(16)).join(", "));
  }

  if (kvAttrs.length > 0) {
    log.info("Key-Value Attributes:");
    for (const attr of kvAttrs) {
      const name = attr[0] ?? attr.name;
      const value = attr[1] ?? attr.value;
      log.info(`  ${name}: ${ethers.hexlify(value)}`);
    }
  }

  if (arrayAttrs.length > 0) {
    log.info("Array Attributes:");
    for (const attr of arrayAttrs) {
      const name = attr[0] ?? attr.name;
      const items = attr[1] ?? attr.values ?? [];
      log.info(`  ${name}: (${Array.from(items).length} items)`);
      for (const item of Array.from(items)) {
        const val = (item as any)[0] ?? (item as any).value;
        const revoked = (item as any)[1] ?? (item as any).revoked ?? false;
        const prefix = revoked ? "    [revoked] " : "    ";
        try {
          const text = ethers.toUtf8String(val);
          // Try to parse as JSON for pretty printing
          try {
            const json = JSON.parse(text);
            log.info(`${prefix}${JSON.stringify(json)}`);
          } catch {
            log.info(`${prefix}${text}`);
          }
        } catch {
          log.info(`${prefix}${ethers.hexlify(val)}`);
        }
      }
    }
  }
}

async function queryReputation(agentId: bigint) {
  log.step("ERC-8004 Reputation");

  const score = await reputation.getScore(agentId);
  log.info("Agent ID:", agentId.toString());
  log.info("Reputation Score:", score.toString());

  // Query recent feedback events
  const filter = reputation.filters.NewFeedback(agentId);
  const events = await reputation.queryFilter(filter);
  log.info(`Feedback count: ${events.length}`);

  for (const event of events) {
    const parsed = reputation.interface.parseLog({
      topics: [...event.topics],
      data: event.data,
    });
    if (parsed) {
      log.info(`  Score: ${parsed.args.score}, From: ${parsed.args.clientAddress}, Tag: ${ethers.decodeBytes32String(parsed.args.tag1)}`);
    }
  }
}

async function queryValidation(agentId: bigint) {
  log.step("ERC-8004 Validation");

  // Query validation request events
  const reqFilter = validation.filters.ValidationRequest(null, agentId);
  const reqEvents = await validation.queryFilter(reqFilter);
  log.info("Agent ID:", agentId.toString());
  log.info(`Validation records: ${reqEvents.length}`);

  for (const event of reqEvents) {
    const parsed = validation.interface.parseLog({
      topics: [...event.topics],
      data: event.data,
    });
    if (!parsed) continue;

    const requestHash = parsed.args.requestHash;
    log.info(`  Request: ${requestHash.slice(0, 18)}...`);
    log.info(`    Validator: ${parsed.args.validatorAddress}`);
    log.info(`    URI: ${parsed.args.requestUri}`);

    // Check if there's a response
    try {
      const status = await validation.getValidationStatus(requestHash);
      const response = status[2]; // response field
      if (response > 0) {
        const tag = status[4]; // tag field
        log.info(`    Response: score=${response}, tag=${ethers.decodeBytes32String(tag)}`);
      }
    } catch {}
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  log.header(`Query Tool — Chain ${network.chainId}`);

  // Get agentId from arg or agent-info.json
  let agentIdStr = process.argv[2];
  if (!agentIdStr) {
    try {
      const info = JSON.parse(fs.readFileSync(AGENT_INFO_FILE, "utf-8"));
      agentIdStr = info.agentId;
      log.info("Using agentId from agent-info.json");
    } catch {
      console.error("Usage: tsx src/query/index.ts [agentId]");
      console.error("  Or run Provider first to generate agent-info.json");
      process.exit(1);
    }
  }

  const agentId = BigInt(agentIdStr);

  // Query all
  await queryAgentInfo(agentId);

  // Get DID from metadata and query DID document
  try {
    const didBytes = await identity.getMetadata(agentId, "codatta:did");
    const didIdentifier = ethers.AbiCoder.defaultAbiCoder().decode(["uint128"], didBytes)[0];
    await queryDIDDocument(didIdentifier);
  } catch {
    log.info("No Codatta DID linked, skipping DID query");
  }

  await queryReputation(agentId);
  await queryValidation(agentId);
}

main().catch((err) => {
  console.error("[QUERY] Fatal:", err.message);
  process.exit(1);
});
