/**
 * Codatta Invite Service
 *
 * Standalone service that:
 * 1. Generates signed invite codes for Providers to distribute
 * 2. Listens for InviteRegistered events on-chain
 * 3. Tracks invite attribution (who invited whom)
 * 4. Provides API for Web Dashboard
 */
import { ethers } from "ethers";
import express from "express";
import { provider, getWallet, addresses } from "../shared/config.js";
import * as log from "../shared/logger.js";

log.setRole("invite-svc");

// Invite Service uses the deployer key as signer (matches InviteRegistrar's inviteSigner)
const signer = getWallet("DEPLOYER_PRIVATE_KEY");

const INVITE_SERVICE_PORT = 4060;

// ── ABI for InviteRegistrar events ──────────────────────────────
const InviteRegistrarABI = [
  "event InviteRegistered(uint128 indexed identifier, address indexed owner, address indexed inviter, uint256 nonce)",
];

// ── In-memory invite store ──────────────────────────────────────

interface InviteRecord {
  nonce: number;
  inviter: string; // provider address
  clientAddress: string;
  signature: string;
  clientDid: string | null;
  claimed: boolean;
  claimedAt: string | null;
  createdAt: string;
}

const inviteStore = new Map<number, InviteRecord>(); // nonce → record
let nonceCounter = 1;

// ── Generate signed invite code ─────────────────────────────────

async function generateInviteCode(inviter: string, clientAddress: string): Promise<{
  nonce: number;
  signature: string;
} | null> {
  // Return existing invite if already generated
  for (const record of inviteStore.values()) {
    if (record.inviter.toLowerCase() === inviter.toLowerCase() &&
        record.clientAddress.toLowerCase() === clientAddress.toLowerCase()) {
      return { nonce: record.nonce, signature: record.signature };
    }
  }

  const nonce = nonceCounter++;
  const chainId = (await provider.getNetwork()).chainId;

  // Sign: keccak256(inviter, client, nonce, chainId, inviteRegistrarAddress)
  // Must match InviteRegistrar.sol's verification
  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "address", "uint256", "uint256", "address"],
    [inviter, clientAddress, nonce, chainId, addresses.inviteRegistrar]
  );
  const signature = await signer.signMessage(ethers.getBytes(messageHash));

  inviteStore.set(nonce, {
    nonce,
    inviter,
    clientAddress,
    signature,
    clientDid: null,
    claimed: false,
    claimedAt: null,
    createdAt: new Date().toISOString(),
  });

  log.info(`Invite generated: nonce=${nonce}, inviter=${inviter.slice(0, 10)}..., client=${clientAddress.slice(0, 10)}...`);

  return { nonce, signature };
}

// ── Listen for on-chain InviteRegistered events ─────────────────

async function startEventListener() {
  const inviteRegistrar = new ethers.Contract(
    addresses.inviteRegistrar, InviteRegistrarABI, provider
  );

  inviteRegistrar.on("InviteRegistered", (identifier: bigint, owner: string, inviter: string, nonce: bigint) => {
    const n = Number(nonce);
    const record = inviteStore.get(n);

    if (record) {
      record.clientDid = `did:codatta:${identifier.toString(16)}`;
      record.claimed = true;
      record.claimedAt = new Date().toISOString();
      log.event("InviteRegistered", `nonce=${n}, DID=${record.clientDid}, inviter=${inviter.slice(0, 10)}...`);
    } else {
      log.info(`InviteRegistered for unknown nonce=${n}, DID=did:codatta:${identifier.toString(16)}`);
    }
  });

  log.info("Listening for InviteRegistered events...");
}

// ── HTTP API ────────────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  log.header(`Invite Service — Chain ${network.chainId}`);
  log.info("Signer:", signer.address);
  log.info("InviteRegistrar:", addresses.inviteRegistrar);

  // Start event listener
  await startEventListener();

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  // POST /generate — Provider requests an invite code
  app.post("/generate", async (req, res) => {
    const { inviter, clientAddress } = req.body;

    if (!inviter || !clientAddress) {
      res.status(400).json({ error: "inviter and clientAddress required" });
      return;
    }

    const result = await generateInviteCode(inviter, clientAddress);
    if (!result) {
      res.status(500).json({ error: "Failed to generate invite code" });
      return;
    }

    res.json({
      nonce: result.nonce,
      signature: result.signature,
      inviteRegistrar: addresses.inviteRegistrar,
    });
  });

  // GET /invites — All invite records (for Web Dashboard)
  app.get("/invites", (_req, res) => {
    const records = Array.from(inviteStore.values());
    res.json({
      total: records.length,
      claimed: records.filter(r => r.claimed).length,
      invites: records.map(r => ({
        nonce: r.nonce,
        inviter: r.inviter,
        clientAddress: r.clientAddress,
        clientDid: r.clientDid,
        claimed: r.claimed,
        claimedAt: r.claimedAt,
        createdAt: r.createdAt,
      })),
    });
  });

  // GET /invites/:inviter — Invites by provider (for Provider Dashboard)
  app.get("/invites/:inviter", (req, res) => {
    const inviter = req.params.inviter.toLowerCase();
    const records = Array.from(inviteStore.values()).filter(
      r => r.inviter.toLowerCase() === inviter
    );
    res.json({
      total: records.length,
      claimed: records.filter(r => r.claimed).length,
      invites: records.map(r => ({
        nonce: r.nonce,
        clientAddress: r.clientAddress,
        clientDid: r.clientDid,
        claimed: r.claimed,
        claimedAt: r.claimedAt,
        createdAt: r.createdAt,
      })),
    });
  });

  // ── Agent visibility management ──────────────────────────────

  const hiddenAgents = new Set<string>(); // agentId strings

  app.post("/agents/:agentId/hide", (req, res) => {
    hiddenAgents.add(req.params.agentId);
    log.info(`Agent hidden: ${req.params.agentId}`);
    res.json({ status: "hidden", agentId: req.params.agentId });
  });

  app.post("/agents/:agentId/show", (req, res) => {
    hiddenAgents.delete(req.params.agentId);
    log.info(`Agent shown: ${req.params.agentId}`);
    res.json({ status: "visible", agentId: req.params.agentId });
  });

  app.get("/agents/hidden", (_req, res) => {
    res.json({ hidden: Array.from(hiddenAgents) });
  });

  // GET /health
  app.get("/health", (_req, res) => {
    res.json({ status: "ok", service: "codatta-invite-service", totalInvites: inviteStore.size, hiddenAgents: hiddenAgents.size });
  });

  app.listen(INVITE_SERVICE_PORT, () => {
    log.success(`Invite Service running on http://127.0.0.1:${INVITE_SERVICE_PORT}`);
    log.info("  POST /generate              — generate signed invite code");
    log.info("  GET  /invites               — all invite records");
    log.info("  GET  /invites/:inviter      — invites by provider");
    log.info("  POST /agents/:id/hide       — hide agent");
    log.info("  POST /agents/:id/show       — show agent");
    log.info("  GET  /agents/hidden         — hidden agent list");
    log.waiting("Ready");
  });
}

main().catch((err) => {
  console.error("[INVITE-SVC] Fatal:", err.message);
  process.exit(1);
});
