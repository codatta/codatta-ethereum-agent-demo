/**
 * Async base-framework self-test harness. NOT a business client.
 *
 * In the target architecture there is exactly ONE client agent, not one per
 * business. Different businesses are different (serviceName, MCP tool,
 * payload/result schema) and the packing/parsing is delegated to business-
 * specific libraries loaded at runtime — not to a dedicated entry script.
 *
 * This file exists only so the async framework itself (submit_task / get_task
 * / list_tasks + invite-service task queue + web inbox) can be exercised end-
 * to-end from the CLI while we bootstrap. When real businesses come online
 * they will be invoked through the unified client, and this script becomes
 * redundant.
 *
 *   Flow (default `submit` command)
 *     1. Ensure client is registered on ERC-8004 (reuse / register).
 *     2. Discover a provider that declares `asyncServices` in its profile.
 *     3. A2A consultation: greet + request invite code.
 *     4. Optionally register a Codatta DID on-chain via InviteRegistrar.
 *     5. Call MCP `submit_task` → taskId.
 *     6. Stay connected and poll `get_task` until the task reaches a terminal
 *        state, pacing by the provider's `retryAfterSeconds` hint.
 *
 *   Usage
 *     npm run start:client-async                     # full pre-flight + submit + keep polling
 *     npm run start:client-async -- submit "msg"
 *     npm run start:client-async -- poll <taskId?>   # one-shot status
 *     npm run start:client-async -- watch <taskId?>  # re-attach to existing taskId, poll to terminal
 *     npm run start:client-async -- list
 *
 * The existing synchronous client (./index.ts) is untouched.
 */
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { provider, getWallet, addresses, hexToDidUri } from "../shared/config.js";
import { IdentityRegistryABI, InviteRegistrarABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("client-async");

const STATE_FILE = path.join(import.meta.dirname, "../../async-client-state.json");
const CLIENT_IDENTITY_FILE = path.join(import.meta.dirname, "../../client-identity.json");

// ── Persistent state ────────────────────────────────────────────

interface AsyncClientState {
  lastTaskId?: string;
  providerMcp?: string;
  providerAgentId?: string;
}

function loadState(): AsyncClientState {
  try {
    if (fs.existsSync(STATE_FILE)) return JSON.parse(fs.readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return {};
}

function saveState(s: AsyncClientState) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(s, null, 2));
}

function loadClientIdentity(): { agentId?: string; chainId?: number } | null {
  try {
    if (fs.existsSync(CLIENT_IDENTITY_FILE)) {
      return JSON.parse(fs.readFileSync(CLIENT_IDENTITY_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveClientIdentity(data: { agentId: string; chainId: number }) {
  fs.writeFileSync(CLIENT_IDENTITY_FILE, JSON.stringify(data, null, 2));
}

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim().toLowerCase()); });
  });
}

// ── ERC-8004 registration file fetch ────────────────────────────

async function fetchRegistrationFile(uri: string): Promise<Record<string, unknown>> {
  if (uri.startsWith("data:application/json;base64,")) {
    return JSON.parse(Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString());
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`tokenURI fetch failed: HTTP ${res.status}`);
    return await res.json() as Record<string, unknown>;
  }
  return {};
}

// ── Client on-chain identity ────────────────────────────────────

async function ensureClientRegistered(wallet: ethers.Wallet, identity: ethers.Contract, network: ethers.Network): Promise<bigint> {
  const saved = loadClientIdentity();
  if (saved?.agentId && saved?.chainId === Number(network.chainId)) {
    const id = BigInt(saved.agentId);
    try {
      const owner = await identity.ownerOf(id);
      if (owner.toLowerCase() === wallet.address.toLowerCase()) {
        log.info(`Client already registered: agentId=${id}`);
        return id;
      }
    } catch {}
  }

  log.info("Registering client on ERC-8004 IdentityRegistry...");
  const tokenUri = Buffer.from(JSON.stringify({
    name: "Async Client Agent", description: "Async framework demo client", type: "client", services: [],
  })).toString("base64");
  const tx = await identity.register(`data:application/json;base64,${tokenUri}`);
  const receipt = await tx.wait();
  const regEvent = receipt.logs
    .map((l: ethers.Log) => {
      try { return identity.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "Registered");
  if (!regEvent) throw new Error("Client registration failed");
  const agentId = BigInt(regEvent.args.agentId);
  saveClientIdentity({ agentId: agentId.toString(), chainId: Number(network.chainId) });
  log.success(`Registered: agentId=${agentId}`);
  return agentId;
}

// ── Provider discovery ──────────────────────────────────────────

interface DiscoveredProvider {
  agentId: bigint;
  owner: string;
  mcpEndpoint: string;
  a2aEndpoint: string | null;
  asyncServices: Array<{ name: string; description?: string; avgTurnaround?: string }>;
}

async function discoverAsyncProvider(identity: ethers.Contract, excludeOwner: string): Promise<DiscoveredProvider> {
  const events = await identity.queryFilter(identity.filters.Registered());
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as any;
    const id = BigInt(evt.args.agentId || evt.args[0]);
    const owner = (evt.args.owner || evt.args[2]) as string;
    if (owner.toLowerCase() === excludeOwner.toLowerCase()) continue;
    try {
      const uri = await identity.tokenURI(id);
      const reg = await fetchRegistrationFile(uri);
      const services = (reg.services || []) as Array<{ name: string; endpoint: string }>;
      const mcp = services.find(s => s.name === "MCP");
      const a2a = services.find(s => s.name === "A2A");
      const asyncServices = (reg.asyncServices || []) as Array<{ name: string; description?: string; avgTurnaround?: string }>;
      if (mcp && asyncServices.length > 0) {
        return { agentId: id, owner, mcpEndpoint: mcp.endpoint, a2aEndpoint: a2a?.endpoint || null, asyncServices };
      }
    } catch {}
  }
  throw new Error("No ERC-8004 provider found with asyncServices declared.");
}

// ── A2A consultation + invite code ──────────────────────────────

let rpcId = 1;
const A2A_CONTEXT = `async-client-ctx-${Date.now()}`;

async function a2aSend(url: string, taskId: string | undefined, parts: any[]): Promise<any> {
  const body = {
    jsonrpc: "2.0", id: rpcId++, method: "message/send",
    params: {
      id: taskId || `task-${Date.now()}`,
      message: {
        role: "user",
        messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contextId: A2A_CONTEXT,
        parts,
      },
    },
  };
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const json = await res.json() as any;
  if (json.error) throw new Error(`A2A error: ${json.error.message}`);
  return json.result;
}

function getAgentText(result: any): string {
  const history = result.history || [];
  const agent = history.filter((m: any) => m.role === "agent");
  const last = agent[agent.length - 1];
  return last?.parts?.find((p: any) => p.type === "text" || p.kind === "text")?.text || "";
}

function getAgentData(result: any): any {
  const history = result.history || [];
  const agent = history.filter((m: any) => m.role === "agent");
  const last = agent[agent.length - 1];
  return last?.parts?.find((p: any) => p.type === "data" || p.kind === "data")?.data || {};
}

interface InvitePayload {
  action?: string;
  inviter?: string;
  nonce?: number;
  signature?: string;
  inviteRegistrar?: string;
  clientDid?: string;
  remainingQuota?: number;
}

async function a2aGetInvite(a2aEndpoint: string, clientAddress: string): Promise<InvitePayload> {
  const a2aUrl = a2aEndpoint.replace("/.well-known/agent-card.json", "");
  log.info("A2A consultation with provider...");
  const first = await a2aSend(a2aUrl, undefined, [{
    type: "text",
    text: "Hi, I want to submit an async task. Can you send me an invite code for free quota?",
  }]);
  const taskId = first.id;
  log.info(`Provider: ${getAgentText(first).slice(0, 100)}...`);

  const second = await a2aSend(a2aUrl, taskId, [
    { type: "text", text: "Yes please, give me an invite code." },
    { type: "data", data: { clientAddress } },
  ]);
  const data = getAgentData(second) as InvitePayload;
  return data;
}

// ── Optional DID registration via InviteRegistrar ───────────────

async function maybeRegisterDid(inviteRegistrar: ethers.Contract, invite: InvitePayload): Promise<string | null> {
  if (!invite.nonce || !invite.signature || !invite.inviter) return null;

  log.info(`Invite received: nonce=${invite.nonce}, inviter=${invite.inviter.slice(0, 10)}...`);
  const answer = await askUser("\n  Register Codatta DID on-chain with this invite? (y/n, default=n): ");
  if (answer !== "y" && answer !== "yes") {
    log.info("Declined DID registration — proceeding without invite attribution.");
    return null;
  }

  log.info("Registering DID via InviteRegistrar...");
  const tx = await inviteRegistrar.registerWithInvite(invite.inviter, invite.nonce, invite.signature);
  const receipt = await tx.wait();
  const event = receipt.logs
    .map((l: ethers.Log) => {
      try { return inviteRegistrar.interface.parseLog({ topics: [...l.topics], data: l.data }); } catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "InviteRegistered");
  if (!event) throw new Error("InviteRegistered event missing");
  const clientDid = hexToDidUri(event.args.identifier.toString(16));
  log.success(`Registered DID: ${clientDid}`);
  return clientDid;
}

// ── MCP parse helper ────────────────────────────────────────────

function parseTextContent(content: unknown): any {
  if (!Array.isArray(content)) return null;
  const text = content.find((c: any) => c.type === "text") as { text?: string } | undefined;
  if (!text?.text) return null;
  try { return JSON.parse(text.text); } catch { return text.text; }
}

// ── Watch loop (poll until terminal, pacing by retryAfterSeconds) ─

const TERMINAL = new Set(["completed", "failed", "cancelled"]);

async function runWatch(mcp: Client, taskId: string): Promise<void> {
  let lastStatus = "";
  const maxAttempts = 120;
  for (let i = 0; i < maxAttempts; i++) {
    const result = await mcp.callTool({ name: "get_task", arguments: { taskId } });
    const data = parseTextContent(result.content);
    if (!data) { log.info("(no response)"); return; }
    if (data.error) { log.info(`Error: ${data.error}`); return; }

    if (data.status !== lastStatus) {
      log.info(`status → ${data.status}${data.note ? ` (note: ${data.note})` : ""}`);
      lastStatus = data.status;
    }

    if (TERMINAL.has(data.status)) {
      if (data.status === "completed" && data.result != null) {
        log.success("result:");
        console.log(JSON.stringify(data.result, null, 2));
      } else if (data.error) {
        log.info(`error: ${data.error}`);
      }
      return;
    }

    const waitSec = Math.max(2, Math.min(60, Number(data.retryAfterSeconds) || 10));
    await new Promise((r) => setTimeout(r, waitSec * 1000));
  }
  log.info(`(watch timed out after ${maxAttempts} polls — run 'watch' again to resume)`);
}

// ── Commands ────────────────────────────────────────────────────

async function submitCmd(payloadArg?: string) {
  const wallet = getWallet("CLIENT_PRIVATE_KEY");
  const network = await provider.getNetwork();
  const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
  const inviteRegistrar = new ethers.Contract(addresses.inviteRegistrar, InviteRegistrarABI, wallet);

  log.header(`Async Client — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // 1. Ensure client registered on ERC-8004
  log.step("Client identity");
  await ensureClientRegistered(wallet, identity, network);

  // 2. Discover provider with asyncServices
  log.step("Discovering provider with asyncServices");
  const prov = await discoverAsyncProvider(identity, wallet.address);
  log.info(`Provider agentId=${prov.agentId}, MCP=${prov.mcpEndpoint}`);
  log.info(`Async services offered: ${prov.asyncServices.map(s => s.name).join(", ")}`);

  // 3. A2A consultation + invite code (if A2A endpoint available)
  let clientDid: string | null = null;
  if (prov.a2aEndpoint) {
    log.step("A2A consultation + invite");
    try {
      const invite = await a2aGetInvite(prov.a2aEndpoint, wallet.address);
      if (invite.action === "returning-user" && invite.clientDid) {
        log.info(`Welcome back — already registered: ${invite.clientDid}`);
        clientDid = invite.clientDid;
      } else {
        // 4. Optional DID registration via InviteRegistrar
        clientDid = await maybeRegisterDid(inviteRegistrar, invite);
      }
    } catch (err: any) {
      log.info(`A2A consultation skipped: ${err.message}`);
    }
  } else {
    log.info("Provider has no A2A endpoint — skipping invite flow.");
  }

  // 5. Submit async task via MCP
  log.step("Submitting async task");
  const serviceName = prov.asyncServices[0].name;
  const payload = payloadArg ? { message: payloadArg } : { message: "hello async", timestamp: Date.now() };

  const mcp = new Client({ name: "codatta-async-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(prov.mcpEndpoint));
  await mcp.connect(transport);

  try {
    const submitResult = await mcp.callTool({
      name: "submit_task",
      arguments: {
        serviceName, payload,
        clientAddress: wallet.address,
        ...(clientDid ? { clientDid } : {}),
      },
    });
    const submitData = parseTextContent(submitResult.content);
    if (!submitData || submitData.error) {
      throw new Error(submitData?.error || "submit_task returned no data");
    }

    const taskId = submitData.taskId as string;
    log.success(`Task submitted: ${taskId} (status=${submitData.status})`);
    if (submitData.avgTurnaround || submitData.estimatedSeconds) {
      log.info(`Expected turnaround: ${submitData.avgTurnaround || "n/a"}${submitData.estimatedSeconds ? ` (~${submitData.estimatedSeconds}s)` : ""}`);
    }
    if (submitData.retryAfterSeconds) {
      log.info(`Provider suggests polling every ~${submitData.retryAfterSeconds}s.`);
    }
    saveState({ lastTaskId: taskId, providerMcp: prov.mcpEndpoint, providerAgentId: prov.agentId.toString() });

    // 6. Stay connected — watch until terminal
    log.step("Waiting for provider to confirm the task in the /tasks web inbox");
    log.info("(This process stays alive and polls. Hit Ctrl+C to stop; resume later with `watch`.)");
    await runWatch(mcp, taskId);
  } finally {
    await mcp.close();
  }
}

async function pollCmd(taskIdArg?: string) {
  const state = loadState();
  const taskId = taskIdArg || state.lastTaskId;
  const mcpEndpoint = state.providerMcp;
  if (!taskId || !mcpEndpoint) {
    throw new Error("No prior submission. Run `npm run start:client-async` first, or pass a taskId.");
  }

  log.header("Polling async task");
  log.info(`taskId=${taskId}`);

  const mcp = new Client({ name: "codatta-async-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint));
  await mcp.connect(transport);
  try {
    const result = await mcp.callTool({ name: "get_task", arguments: { taskId } });
    const data = parseTextContent(result.content);
    if (!data || data.error) { log.info(`Error: ${data?.error || "no data"}`); return; }
    log.info(`status: ${data.status}`);
    if (data.note) log.info(`note: ${data.note}`);
    if (data.retryAfterSeconds) log.info(`retryAfterSeconds: ${data.retryAfterSeconds}`);
    if (data.result != null) {
      log.success("result:");
      console.log(JSON.stringify(data.result, null, 2));
    } else {
      log.info("(no result yet)");
    }
  } finally {
    await mcp.close();
  }
}

async function watchCmd(taskIdArg?: string) {
  const state = loadState();
  const taskId = taskIdArg || state.lastTaskId;
  const mcpEndpoint = state.providerMcp;
  if (!taskId || !mcpEndpoint) {
    throw new Error("No prior submission. Run `npm run start:client-async` first, or pass a taskId.");
  }

  log.header("Watching async task");
  log.info(`taskId=${taskId}`);

  const mcp = new Client({ name: "codatta-async-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint));
  await mcp.connect(transport);
  try {
    await runWatch(mcp, taskId);
  } finally {
    await mcp.close();
  }
}

async function listCmd() {
  const state = loadState();
  const mcpEndpoint = state.providerMcp;
  if (!mcpEndpoint) throw new Error("No prior submission. Run `npm run start:client-async` first.");

  const wallet = getWallet("CLIENT_PRIVATE_KEY");
  log.header("Listing my submitted tasks");

  const mcp = new Client({ name: "codatta-async-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpEndpoint));
  await mcp.connect(transport);
  try {
    const result = await mcp.callTool({ name: "list_tasks", arguments: { clientAddress: wallet.address } });
    const data = parseTextContent(result.content);
    if (!data) { log.info("no response"); return; }
    log.info(`total=${data.total}, counts=${JSON.stringify(data.counts)}`);
    for (const t of (data.tasks || [])) {
      log.info(`  ${t.id}  ${t.status.padEnd(10)} ${t.serviceName}  created=${t.createdAt}`);
    }
  } finally {
    await mcp.close();
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const [cmd = "submit", arg] = process.argv.slice(2);
  if (cmd === "submit") await submitCmd(arg);
  else if (cmd === "poll") await pollCmd(arg);
  else if (cmd === "watch") await watchCmd(arg);
  else if (cmd === "list") await listCmd();
  else throw new Error(`Unknown command: ${cmd}. Use submit | poll | watch | list.`);
}

main().catch((err) => {
  console.error("[CLIENT-ASYNC] Fatal:", err.message);
  process.exit(1);
});
