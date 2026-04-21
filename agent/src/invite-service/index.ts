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
import { provider, getWallet, addresses, hexToDidUri } from "../shared/config.js";
import * as log from "../shared/logger.js";

log.setRole("invite-svc");

const signer = getWallet("INVITE_SERVICE_PRIVATE_KEY");
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

interface ServiceRecord {
  id: string;
  agentId: string;
  clientAddress: string;
  task: string;
  imageCount: number;
  duration: string | null;
  status: "completed" | "failed";
  timestamp: string;
}

// ── Generic async task model ─────────────────────────────────────
// Business-agnostic. `serviceName` identifies the service (e.g. "annotation-review",
// "data-validation", "demo-async"). `payload` and `result` are opaque JSON.
type AsyncTaskStatus = "pending" | "accepted" | "working" | "completed" | "failed" | "cancelled";

interface AsyncTask {
  id: string;
  agentId: string;                // provider's ERC-8004 agentId ("" if DID-only)
  providerAddress: string;        // provider's wallet (used for inbox filtering)
  providerDid: string | null;     // did:codatta:<uuid> of provider (optional)
  serviceName: string;            // opaque business identifier
  clientAddress: string;
  clientDid: string | null;
  payload: unknown;               // free-form JSON
  status: AsyncTaskStatus;
  result: unknown | null;         // free-form JSON (set on complete)
  error: string | null;           // set on fail
  note: string | null;            // provider-visible note
  createdAt: string;
  acceptedAt: string | null;
  startedAt: string | null;
  completedAt: string | null;
}

interface StoreData {
  nonceCounter: number;
  invites: Record<string, InviteRecord>;
  hiddenAgents: string[];
  agentRegistrations: Record<string, AgentRegistration>;
  serviceHistory: ServiceRecord[];
  // Agent profile JSON (ERC-8004 registrationFile format), keyed by DID (did:codatta:uuid)
  profiles: Record<string, any>;
  // Generic async task queue — base for any async service (annotation-review, validation, etc.)
  asyncTasks: Record<string, AsyncTask>;
}

let store: StoreData = {
  nonceCounter: 1,
  invites: {},
  hiddenAgents: [],
  agentRegistrations: {},
  serviceHistory: [],
  profiles: {},
  asyncTasks: {},
};

function loadStore() {
  try {
    if (fs.existsSync(DATA_FILE)) {
      const loaded = JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
      // Backfill missing keys from older data files
      store = { ...store, ...loaded, profiles: loaded.profiles || {}, asyncTasks: loaded.asyncTasks || {} };
      log.info(`Loaded data: ${Object.keys(store.invites).length} invites, ${store.hiddenAgents.length} hidden, ${Object.keys(store.agentRegistrations).length} registrations, ${Object.keys(store.profiles).length} profiles, ${Object.keys(store.asyncTasks).length} async tasks`);
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
      record.clientDid = hexToDidUri(identifier.toString(16));
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
    res.header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS");
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

      // Response may be JSON or SSE stream — parse accordingly
      const contentType = toolsRes.headers.get("content-type") || "";
      let toolsData: any;

      if (contentType.includes("text/event-stream")) {
        // Parse SSE: extract JSON from "data: {...}" lines
        const text = await toolsRes.text();
        const dataLines = text.split("\n").filter(l => l.startsWith("data: "));
        for (const line of dataLines) {
          try {
            const parsed = JSON.parse(line.slice(6));
            if (parsed.result?.tools) { toolsData = parsed; break; }
          } catch {}
        }
        if (!toolsData) {
          res.json({ status: "fail", error: "Could not parse tools from SSE response" });
          return;
        }
      } else {
        toolsData = await toolsRes.json();
      }

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

  // ── Service history ──────────────────────────────────────────

  // Provider reports a completed service call
  app.post("/service-history", (req, res) => {
    const { agentId, clientAddress, task, imageCount, duration, status } = req.body;
    const record: ServiceRecord = {
      id: `svc-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      agentId: agentId || "",
      clientAddress: clientAddress || "",
      task: task || "unknown",
      imageCount: imageCount || 0,
      duration: duration || null,
      status: status || "completed",
      timestamp: new Date().toISOString(),
    };
    store.serviceHistory.push(record);
    saveStore();
    log.info(`Service recorded: ${record.id} agent=${agentId} images=${imageCount}`);
    res.json(record);
  });

  // Get service history for an agent
  app.get("/service-history/:agentId", (req, res) => {
    const records = store.serviceHistory.filter(r => r.agentId === req.params.agentId);
    res.json({
      total: records.length,
      totalImages: records.reduce((sum, r) => sum + r.imageCount, 0),
      records: records.slice(-50).reverse(), // last 50, newest first
    });
  });

  // Get all service history (for dashboard overview)
  app.get("/service-history", (_req, res) => {
    res.json({
      total: store.serviceHistory.length,
      totalImages: store.serviceHistory.reduce((sum, r) => sum + r.imageCount, 0),
      records: store.serviceHistory.slice(-50).reverse(),
    });
  });

  // ── Try it proxy — calls Provider's REST /annotate via backend ──

  app.post("/try-annotate", async (req, res) => {
    const { mcpUrl, images, task } = req.body;
    if (!mcpUrl || !images) {
      res.status(400).json({ error: "mcpUrl and images required" });
      return;
    }

    // Derive REST endpoint from MCP URL: replace /mcp with nothing, port - 1
    // e.g., http://host:4022/mcp → http://host:4021/annotate
    try {
      const url = new URL(mcpUrl);
      const mcpPort = parseInt(url.port);
      url.port = (mcpPort - 1).toString();
      url.pathname = "/annotate";
      const restUrl = url.toString();

      log.info(`Try-it proxy: ${restUrl} (${images.length} images)`);

      const annotateRes = await fetch(restUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ images, task: task || "object-detection" }),
      });

      if (!annotateRes.ok) {
        res.json({ error: `Provider returned HTTP ${annotateRes.status}` });
        return;
      }

      const data = await annotateRes.json();
      res.json(data);
    } catch (err: any) {
      res.json({ error: `Cannot reach provider: ${err.message}` });
    }
  });

  // ── Agent profile (ERC-8004 registrationFile canonical home) ─
  //
  // Profile JSON is the single source of truth for an agent's metadata and
  // service endpoints. Referenced from:
  //   - DID document's `service` array via `{ type: "AgentProfile", serviceEndpoint: <url> }`
  //   - ERC-8004 IdentityRegistry's tokenURI (returns this URL)
  //
  // Dev-mode: no auth. Production should require DID-owner signature on write.

  function normalizeDidKey(raw: string): string {
    // Accept "did:codatta:<uuid>" or raw hex (with or without dashes). Normalize to did URI.
    const lower = raw.toLowerCase().trim();
    if (lower.startsWith("did:codatta:")) return lower;
    const hex = lower.replace(/^0x/, "").replace(/-/g, "");
    return hexToDidUri(hex);
  }

  app.put("/profiles/:did", (req, res) => {
    const did = normalizeDidKey(req.params.did);
    const profile = req.body;
    if (!profile || typeof profile !== "object") {
      res.status(400).json({ error: "profile JSON required in body" });
      return;
    }
    store.profiles[did] = profile;
    saveStore();
    log.info(`Profile saved: ${did}`);
    res.json({ status: "ok", did, url: `/profiles/${did}` });
  });

  app.get("/profiles/:did", (req, res) => {
    const did = normalizeDidKey(req.params.did);
    const profile = store.profiles[did];
    if (!profile) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    res.json(profile);
  });

  app.delete("/profiles/:did", (req, res) => {
    const did = normalizeDidKey(req.params.did);
    if (!store.profiles[did]) {
      res.status(404).json({ error: "Profile not found" });
      return;
    }
    delete store.profiles[did];
    saveStore();
    log.info(`Profile deleted: ${did}`);
    res.json({ status: "ok", did });
  });

  // ── Async task queue (generic base for async services) ──────
  //
  // Any service built on the async framework stores its tasks here.
  // `serviceName` identifies the business (opaque string — e.g. "annotation-review",
  // "data-validation", "demo-async"). `payload` and `result` are free-form JSON
  // whose shape is defined by the service itself, not this layer.

  const TERMINAL_STATUSES: AsyncTaskStatus[] = ["completed", "failed", "cancelled"];
  const ALLOWED_TRANSITIONS: Record<AsyncTaskStatus, AsyncTaskStatus[]> = {
    pending: ["accepted", "working", "failed", "cancelled"],
    accepted: ["working", "completed", "failed", "cancelled"],
    working: ["completed", "failed", "cancelled"],
    completed: [],
    failed: [],
    cancelled: [],
  };

  function transitionTask(task: AsyncTask, next: AsyncTaskStatus, extra: Partial<AsyncTask> = {}): AsyncTask {
    if (!ALLOWED_TRANSITIONS[task.status].includes(next)) {
      throw new Error(`Cannot transition task ${task.id} from ${task.status} to ${next}`);
    }
    const now = new Date().toISOString();
    const updated: AsyncTask = { ...task, ...extra, status: next };
    if (next === "accepted" && !updated.acceptedAt) updated.acceptedAt = now;
    if (next === "working" && !updated.startedAt) updated.startedAt = now;
    if (TERMINAL_STATUSES.includes(next)) updated.completedAt = now;
    store.asyncTasks[task.id] = updated;
    saveStore();
    return updated;
  }

  // Create a task (provider's MCP handler calls this on behalf of a client)
  app.post("/tasks", (req, res) => {
    const { agentId, providerAddress, providerDid, serviceName, clientAddress, clientDid, payload, note } = req.body || {};
    if (!providerAddress || !serviceName) {
      res.status(400).json({ error: "providerAddress and serviceName required" });
      return;
    }
    const id = `atk-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const task: AsyncTask = {
      id,
      agentId: agentId ? String(agentId) : "",
      providerAddress: String(providerAddress),
      providerDid: providerDid || null,
      serviceName: String(serviceName),
      clientAddress: clientAddress ? String(clientAddress) : "",
      clientDid: clientDid || null,
      payload: payload ?? null,
      status: "pending",
      result: null,
      error: null,
      note: note || null,
      createdAt: new Date().toISOString(),
      acceptedAt: null,
      startedAt: null,
      completedAt: null,
    };
    store.asyncTasks[id] = task;
    saveStore();
    log.info(`Task created: ${id} service=${serviceName} agent=${task.agentId || "(none)"} client=${task.clientAddress.slice(0, 10)}...`);
    res.status(201).json(task);
  });

  // Get single task
  app.get("/tasks/:taskId", (req, res) => {
    const task = store.asyncTasks[req.params.taskId];
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    res.json(task);
  });

  // List tasks — filter by providerAddress (owner inbox), agentId, clientAddress,
  // serviceName, status. All filters optional; multiple are AND-combined.
  //
  // `counts` reflects the totals *before* the `status` filter so filter UIs
  // can show a stable badge for every bucket. Non-status filters (provider,
  // agent, client, serviceName) still apply — counts are the full distribution
  // of the inbox being viewed, not the global distribution.
  app.get("/tasks", (req, res) => {
    const { providerAddress, agentId, clientAddress, serviceName, status, limit } = req.query as Record<string, string>;
    let scoped = Object.values(store.asyncTasks);
    if (providerAddress) scoped = scoped.filter(t => t.providerAddress.toLowerCase() === providerAddress.toLowerCase());
    if (agentId) scoped = scoped.filter(t => t.agentId === agentId);
    if (clientAddress) scoped = scoped.filter(t => t.clientAddress.toLowerCase() === clientAddress.toLowerCase());
    if (serviceName) scoped = scoped.filter(t => t.serviceName === serviceName);

    // Counts over the scoped set (before the status filter).
    const counts: Record<AsyncTaskStatus, number> = { pending: 0, accepted: 0, working: 0, completed: 0, failed: 0, cancelled: 0 };
    for (const t of scoped) counts[t.status]++;

    // Apply status filter only to the returned items.
    let items = scoped;
    if (status) {
      const wanted = status.split(",");
      items = items.filter(t => wanted.includes(t.status));
    }
    items.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const cap = Math.max(1, Math.min(500, parseInt(limit || "100")));
    res.json({ total: items.length, counts, tasks: items.slice(0, cap) });
  });

  // State transitions — all take optional { note } and action-specific fields.
  app.post("/tasks/:taskId/accept", (req, res) => {
    const task = store.asyncTasks[req.params.taskId];
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    try { res.json(transitionTask(task, "accepted", { note: req.body?.note ?? task.note })); }
    catch (err: any) { res.status(409).json({ error: err.message }); }
  });

  app.post("/tasks/:taskId/work", (req, res) => {
    const task = store.asyncTasks[req.params.taskId];
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    try { res.json(transitionTask(task, "working", { note: req.body?.note ?? task.note })); }
    catch (err: any) { res.status(409).json({ error: err.message }); }
  });

  app.post("/tasks/:taskId/complete", (req, res) => {
    const task = store.asyncTasks[req.params.taskId];
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    const { result, note } = req.body || {};
    try { res.json(transitionTask(task, "completed", { result: result ?? null, note: note ?? task.note })); }
    catch (err: any) { res.status(409).json({ error: err.message }); }
  });

  app.post("/tasks/:taskId/fail", (req, res) => {
    const task = store.asyncTasks[req.params.taskId];
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    const { error, note } = req.body || {};
    try { res.json(transitionTask(task, "failed", { error: error || "failed", note: note ?? task.note })); }
    catch (err: any) { res.status(409).json({ error: err.message }); }
  });

  app.post("/tasks/:taskId/cancel", (req, res) => {
    const task = store.asyncTasks[req.params.taskId];
    if (!task) { res.status(404).json({ error: "Task not found" }); return; }
    try { res.json(transitionTask(task, "cancelled", { note: req.body?.note ?? task.note })); }
    catch (err: any) { res.status(409).json({ error: err.message }); }
  });

  // ── Faucet ──────────────────────────────────────────────────

  const FAUCET_AMOUNT = ethers.parseEther("1.0");

  app.post("/faucet", async (req, res) => {
    const { address } = req.body;
    if (!address) {
      res.status(400).json({ error: "address required" });
      return;
    }
    try {
      const tx = await signer.sendTransaction({ to: address, value: FAUCET_AMOUNT });
      await tx.wait();
      log.info(`Faucet: sent 1 ETH to ${address}`);
      res.json({ status: "ok", txHash: tx.hash, amount: "1.0 ETH" });
    } catch (err: any) {
      log.info(`Faucet failed: ${err.message}`);
      res.json({ error: err.message });
    }
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

  app.listen(INVITE_SERVICE_PORT, "0.0.0.0", () => {
    log.success(`Invite Service running on http://127.0.0.1:${INVITE_SERVICE_PORT}`);
    log.info("  POST /generate                    — generate signed invite code");
    log.info("  GET  /invites                     — all invite records");
    log.info("  POST /agents/:id/hide|show        — toggle visibility");
    log.info("  GET  /agents/hidden               — hidden list");
    log.info("  PUT  /agents/:id/registration     — save registration progress");
    log.info("  GET  /registrations/pending/:owner — pending registrations");
    log.info("  PUT/GET/DELETE /profiles/:did     — agent profile (ERC-8004 registrationFile)");
    log.info("  POST /tasks                       — create async task");
    log.info("  GET  /tasks?providerAddress=...   — inbox / list tasks");
    log.info("  GET  /tasks/:id                   — get single task");
    log.info("  POST /tasks/:id/{accept,work,complete,fail,cancel} — state transitions");
    log.waiting("Ready");
  });
}

main().catch((err) => {
  console.error("[INVITE-SVC] Fatal:", err.message);
  process.exit(1);
});
