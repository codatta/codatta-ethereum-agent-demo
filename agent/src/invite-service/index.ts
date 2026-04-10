/**
 * Codatta Invite Service
 *
 * Standalone service that:
 * 1. Generates signed invite codes for Providers to distribute
 * 2. Listens for InviteRegistered events on-chain
 * 3. Tracks invite attribution (who invited whom)
 * 4. Tracks agent registration status (pending verification)
 * 5. Manages agent visibility (hidden/shown)
 * 6. Persists all data to disk
 */
import { ethers } from "ethers";
import express from "express";
import fs from "fs";
import path from "path";
import { provider, getWallet, addresses } from "../shared/config.js";
import * as log from "../shared/logger.js";

log.setRole("invite-svc");

const signer = getWallet("DEPLOYER_PRIVATE_KEY");
const INVITE_SERVICE_PORT = 4060;
const DATA_FILE = path.join(import.meta.dirname, "../../invite-service-data.json");

const InviteRegistrarABI = [
  "event InviteRegistered(uint128 indexed identifier, address indexed owner, address indexed inviter, uint256 nonce)",
];

// ── Persistent data store ───────────────────────────────────────

interface InviteRecord {
  nonce: number;
  inviter: string;
  clientAddress: string;
  signature: string;
  clientDid: string | null;
  claimed: boolean;
  claimedAt: string | null;
  createdAt: string;
}

interface AgentRegistration {
  agentId: string;
  didHex: string;
  serviceType: string;
  name: string;
  owner: string;
  mcpUrl: string | null;
  verified: boolean;
  step: "did" | "agent" | "verify" | "done";
  createdAt: string;
  verifiedAt: string | null;
}

interface StoreData {
  nonceCounter: number;
  invites: Record<string, InviteRecord>; // nonce → record
  hiddenAgents: string[];
  agentRegistrations: Record<string, AgentRegistration>; // agentId → status
}

let store: StoreData = {
  nonceCounter: 1,
  invites: {},
  hiddenAgents: [],
  agentRegistrations: {},
};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      store = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      log.info(`Loaded data: ${Object.keys(store.invites).length} invites, ${store.hiddenAgents.length} hidden, ${Object.keys(store.agentRegistrations).length} registrations`);
    }
  } catch (err: any) {
    log.info("No existing data file, starting fresh");
  }
}

function saveStore() {
  fs.writeFileSync(DATA_FILE, JSON.stringify(store, null, 2));
}

// ── Invite code generation ──────────────────────────────────────

async function generateInviteCode(inviter: string, clientAddress: string): Promise<{
  nonce: number;
  signature: string;
} | null> {
  // Return existing if already generated
  for (const record of Object.values(store.invites)) {
    if (record.inviter.toLowerCase() === inviter.toLowerCase() &&
        record.clientAddress.toLowerCase() === clientAddress.toLowerCase()) {
      return { nonce: record.nonce, signature: record.signature };
    }
  }

  const nonce = store.nonceCounter++;
  const chainId = (await provider.getNetwork()).chainId;

  const messageHash = ethers.solidityPackedKeccak256(
    ["address", "address", "uint256", "uint256", "address"],
    [inviter, clientAddress, nonce, chainId, addresses.inviteRegistrar]
  );
  const signature = await signer.signMessage(ethers.getBytes(messageHash));

  store.invites[nonce.toString()] = {
    nonce,
    inviter,
    clientAddress,
    signature,
    clientDid: null,
    claimed: false,
    claimedAt: null,
    createdAt: new Date().toISOString(),
  };
  saveStore();

  log.info(`Invite generated: nonce=${nonce}, inviter=${inviter.slice(0, 10)}..., client=${clientAddress.slice(0, 10)}...`);
  return { nonce, signature };
}

// ── Event listener ──────────────────────────────────────────────

async function startEventListener() {
  const inviteRegistrar = new ethers.Contract(
    addresses.inviteRegistrar, InviteRegistrarABI, provider
  );

  inviteRegistrar.on("InviteRegistered", (identifier: bigint, owner: string, inviter: string, nonce: bigint) => {
    const n = nonce.toString();
    const record = store.invites[n];

    if (record) {
      record.clientDid = `did:codatta:${identifier.toString(16)}`;
      record.claimed = true;
      record.claimedAt = new Date().toISOString();
      saveStore();
      log.event("InviteRegistered", `nonce=${n}, DID=${record.clientDid}`);
    } else {
      log.info(`InviteRegistered for unknown nonce=${n}`);
    }
  });

  log.info("Listening for InviteRegistered events...");
}

// ── HTTP API ────────────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  log.header(`Invite Service — Chain ${network.chainId}`);
  log.info("Signer:", signer.address);

  loadStore();
  await startEventListener();

  const app = express();
  // CORS before json parser
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });
  app.use(express.json());

  // ── Invite endpoints ────────────────────────────────────────

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
    res.json({ nonce: result.nonce, signature: result.signature, inviteRegistrar: addresses.inviteRegistrar });
  });

  app.get("/invites", (_req, res) => {
    const records = Object.values(store.invites);
    res.json({
      total: records.length,
      claimed: records.filter(r => r.claimed).length,
      invites: records.map(r => ({
        nonce: r.nonce, inviter: r.inviter, clientAddress: r.clientAddress,
        clientDid: r.clientDid, claimed: r.claimed, claimedAt: r.claimedAt, createdAt: r.createdAt,
      })),
    });
  });

  app.get("/invites/:inviter", (req, res) => {
    const inviter = req.params.inviter.toLowerCase();
    const records = Object.values(store.invites).filter(r => r.inviter.toLowerCase() === inviter);
    res.json({
      total: records.length,
      claimed: records.filter(r => r.claimed).length,
      invites: records.map(r => ({
        nonce: r.nonce, clientAddress: r.clientAddress, clientDid: r.clientDid,
        claimed: r.claimed, claimedAt: r.claimedAt, createdAt: r.createdAt,
      })),
    });
  });

  // ── Agent visibility ────────────────────────────────────────

  app.post("/agents/:agentId/hide", (req, res) => {
    const id = req.params.agentId;
    if (!store.hiddenAgents.includes(id)) {
      store.hiddenAgents.push(id);
      saveStore();
    }
    log.info(`Agent hidden: ${id}`);
    res.json({ status: "hidden", agentId: id });
  });

  app.post("/agents/:agentId/show", (req, res) => {
    const id = req.params.agentId;
    store.hiddenAgents = store.hiddenAgents.filter(a => a !== id);
    saveStore();
    log.info(`Agent shown: ${id}`);
    res.json({ status: "visible", agentId: id });
  });

  app.get("/agents/hidden", (_req, res) => {
    res.json({ hidden: store.hiddenAgents });
  });

  // ── MCP URL verification (server-side) ──────────────────────

  app.post("/verify-mcp", async (req, res) => {
    const { mcpUrl, requiredTools } = req.body;
    if (!mcpUrl || !requiredTools) {
      res.status(400).json({ error: "mcpUrl and requiredTools required" });
      return;
    }

    log.info(`Verifying MCP: ${mcpUrl} (required: ${requiredTools.join(", ")})`);

    try {
      // Step 1: Initialize MCP session
      const initRes = await fetch(mcpUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "initialize",
          params: {
            protocolVersion: "2025-06-18",
            capabilities: {},
            clientInfo: { name: "codatta-verifier", version: "1.0.0" },
          },
        }),
      });

      if (!initRes.ok) {
        res.json({ status: "fail", error: `MCP init failed: HTTP ${initRes.status}` });
        return;
      }

      const sessionId = initRes.headers.get("mcp-session-id");
      const mcpHeaders: Record<string, string> = { "Content-Type": "application/json", "Accept": "application/json, text/event-stream" };
      if (sessionId) mcpHeaders["mcp-session-id"] = sessionId;

      // Step 2: List tools
      const toolsRes = await fetch(mcpUrl, {
        method: "POST",
        headers: mcpHeaders,
        body: JSON.stringify({ jsonrpc: "2.0", id: 2, method: "tools/list", params: {} }),
      });

      const toolsData = await toolsRes.json() as any;
      const tools = toolsData.result?.tools || [];
      const toolNames = tools.map((t: any) => t.name);

      const missing = (requiredTools as string[]).filter(t => !toolNames.includes(t));

      if (missing.length > 0) {
        log.info(`Verify failed: missing ${missing.join(", ")}`);
        res.json({ status: "fail", error: `Missing tools: ${missing.join(", ")}. Found: ${toolNames.join(", ") || "none"}` });
      } else {
        log.info(`Verify passed: ${toolNames.join(", ")}`);
        res.json({ status: "pass", tools: toolNames });
      }
    } catch (err: any) {
      log.info(`Verify error: ${err.message}`);
      res.json({ status: "fail", error: `Cannot connect: ${err.message}` });
    }
  });

  // ── Agent registration status ───────────────────────────────

  // Save/update registration progress
  app.put("/agents/:agentId/registration", (req, res) => {
    const id = req.params.agentId;
    const existing = store.agentRegistrations[id];
    store.agentRegistrations[id] = { ...existing, ...req.body, agentId: id };
    saveStore();
    log.info(`Registration updated: ${id} step=${req.body.step}`);
    res.json(store.agentRegistrations[id]);
  });

  // Get registration status for an agent
  app.get("/agents/:agentId/registration", (req, res) => {
    const reg = store.agentRegistrations[req.params.agentId];
    if (!reg) { res.status(404).json({ error: "Not found" }); return; }
    res.json(reg);
  });

  // Get all pending (unverified) registrations for an owner
  app.get("/registrations/pending/:owner", (req, res) => {
    const owner = req.params.owner.toLowerCase();
    const pending = Object.values(store.agentRegistrations).filter(
      r => r.owner.toLowerCase() === owner && r.step !== "done"
    );
    res.json({ pending });
  });

  // Get all registrations for an owner
  app.get("/registrations/:owner", (req, res) => {
    const owner = req.params.owner.toLowerCase();
    const regs = Object.values(store.agentRegistrations).filter(
      r => r.owner.toLowerCase() === owner
    );
    res.json({ registrations: regs });
  });

  // ── Health ──────────────────────────────────────────────────

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok", service: "codatta-invite-service",
      invites: Object.keys(store.invites).length,
      hidden: store.hiddenAgents.length,
      registrations: Object.keys(store.agentRegistrations).length,
    });
  });

  app.listen(INVITE_SERVICE_PORT, () => {
    log.success(`Invite Service running on http://127.0.0.1:${INVITE_SERVICE_PORT}`);
    log.info("  POST /generate                    — generate signed invite code");
    log.info("  GET  /invites                     — all invite records");
    log.info("  POST /agents/:id/hide|show        — toggle visibility");
    log.info("  GET  /agents/hidden               — hidden list");
    log.info("  PUT  /agents/:id/registration     — save registration progress");
    log.info("  GET  /registrations/pending/:owner — pending registrations");
    log.waiting("Ready");
  });
}

main().catch((err) => {
  console.error("[INVITE-SVC] Fatal:", err.message);
  process.exit(1);
});
