import { ethers } from "ethers";
import express from "express";
import readline from "readline";
import { randomUUID } from "crypto";
import fs from "fs";
import path from "path";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  type AgentExecutor,
  type RequestContext,
  type ExecutionEventBus,
} from "@a2a-js/sdk/server";
import {
  jsonRpcHandler,
  agentCardHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import type { AgentCard } from "@a2a-js/sdk";
import { z } from "zod";
import { startAnnotationService } from "./annotation-service.js";
import { provider, getWallet, addresses, PROVIDER_PORT, INVITE_SERVICE_URL } from "../shared/config.js";
import {
  DIDRegistryABI,
  IdentityRegistryABI, ValidationRegistryABI, ReputationRegistryABI,
} from "../shared/abis.js";
import { buildFeedbackAuth } from "../shared/feedback-auth.js";
import * as log from "../shared/logger.js";

log.setRole("provider");

const IDENTITY_FILE = path.join(import.meta.dirname, "../../provider-identity.json");
const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

// ── Wallet setup ────────────────────────────────────────────────

async function getOrCreateWallet(): Promise<ethers.Wallet> {
  const envKey = process.env.PROVIDER_PRIVATE_KEY;
  if (envKey) {
    return new ethers.Wallet(envKey, provider);
  }

  // Check saved identity
  if (fs.existsSync(IDENTITY_FILE)) {
    const saved = JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf-8"));
    if (saved.privateKey) {
      log.info("Using saved provider wallet");
      return new ethers.Wallet(saved.privateKey, provider);
    }
  }

  // Ask user
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const answer = await new Promise<string>((resolve) => {
    rl.question("\n  No private key configured. Generate a new one? (y/n): ", resolve);
  });
  rl.close();

  if (answer.trim().toLowerCase() !== "y" && answer.trim().toLowerCase() !== "yes") {
    throw new Error("No private key. Set PROVIDER_PRIVATE_KEY in .env or allow generation.");
  }

  const newWallet = ethers.Wallet.createRandom().connect(provider);
  log.info("Generated new wallet:", newWallet.address);
  log.info("Fund this address with ETH to register on-chain.");

  // Save for next time
  const saved = fs.existsSync(IDENTITY_FILE) ? JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf-8")) : {};
  saved.privateKey = newWallet.privateKey;
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(saved, null, 2));
  log.info("Private key saved to provider-identity.json");

  return newWallet;
}

// ── Identity persistence ────────────────────────────────────────

interface SavedIdentity {
  privateKey?: string;
  agentId?: string;
  codattaDid?: string;
  chainId?: number;
}

function loadIdentity(): SavedIdentity | null {
  try {
    if (fs.existsSync(IDENTITY_FILE)) {
      return JSON.parse(fs.readFileSync(IDENTITY_FILE, "utf-8"));
    }
  } catch {}
  return null;
}

function saveIdentity(data: Partial<SavedIdentity>) {
  const existing = loadIdentity() || {};
  const merged = { ...existing, ...data };
  fs.writeFileSync(IDENTITY_FILE, JSON.stringify(merged, null, 2));
}

// Late-init contracts (depend on wallet)
let wallet: ethers.Wallet;
let didRegistry: ethers.Contract;
let identity: ethers.Contract;
let validationReg: ethers.Contract;
let reputation: ethers.Contract;
const MCP_PORT = PROVIDER_PORT + 1;
const A2A_PORT = PROVIDER_PORT + 2;

// ── Invite Service integration ──────────────────────────────────

async function requestInviteCode(inviter: string, clientAddress: string): Promise<{ nonce: number; signature: string; inviteRegistrar: string } | null> {
  try {
    const res = await fetch(`${INVITE_SERVICE_URL}/generate`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ inviter, clientAddress }),
    });
    if (!res.ok) return null;
    return await res.json() as { nonce: number; signature: string; inviteRegistrar: string };
  } catch {
    log.info("Invite Service unavailable, skipping invite");
    return null;
  }
}

// ── Task store (async annotation) ───────────────────────────────
interface AnnotationTask {
  id: string;
  status: "working" | "completed" | "failed";
  images: string[];
  task: string;
  annotations?: Array<{ image: string; labels: Array<{ class: string; bbox: number[]; confidence: number }> }>;
  feedbackAuth?: string;
  createdAt: number;
  completedAt?: number;
}

const taskStore = new Map<string, AnnotationTask>();
let annotationServiceUrl = ""; // Set after mock service starts

/**
 * Call the annotation backend service.
 * In production: replace annotationServiceUrl with real Codatta API.
 */
async function executeAnnotation(images: string[], task: string, labels?: string[]) {
  // Submit task to backend
  const submitRes = await fetch(`${annotationServiceUrl}/tasks`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ images, taskType: task, labels }),
  });
  const { taskId: svcTaskId } = await submitRes.json() as { taskId: string };

  // Poll for completion
  for (let i = 0; i < 30; i++) {
    await new Promise((r) => setTimeout(r, 500));
    const statusRes = await fetch(`${annotationServiceUrl}/tasks/${svcTaskId}`);
    const statusData = await statusRes.json() as any;
    if (statusData.status === "completed") {
      return statusData.results as Array<{ image: string; labels: Array<{ class: string; bbox: number[]; confidence: number }> }>;
    }
    if (statusData.status === "failed") {
      throw new Error("Annotation backend task failed");
    }
  }
  throw new Error("Annotation backend task timed out");
}

async function updateValidation(agentId: bigint) {
  const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`annotation-${Date.now()}`));
  try {
    await (await validationReg.validationRequest(
      wallet.address, agentId,
      "ipfs://QmAnnotationResult", requestHash
    )).wait();
    await (await validationReg.validationResponse(
      requestHash, 90,
      "ipfs://QmValidationReport",
      ethers.keccak256(ethers.toUtf8Bytes("validation-ok")),
      ethers.encodeBytes32String("annotation")
    )).wait();
    log.info("Validation updated on-chain");
  } catch (e: any) {
    log.info("Validation update skipped:", e.message);
  }
}

function ask(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => { rl.close(); resolve(answer.trim()); });
  });
}

async function promptIdentity(network: ethers.Network): Promise<{ agentId: bigint; codattaDid: bigint }> {
  log.info("");
  log.info("Enter your Agent ID and Codatta DID (from Web Dashboard registration):");
  log.info("");

  const agentIdStr = await ask("  Agent ID: ");
  if (!agentIdStr) throw new Error("Agent ID is required. Register via Web Dashboard first.");

  const didStr = await ask("  Codatta DID (did:codatta:xxx or hex): ");
  if (!didStr) throw new Error("Codatta DID is required. Register via Web Dashboard first.");

  const agentId = BigInt(agentIdStr);
  const didHex = didStr.replace("did:codatta:", "");
  const codattaDid = BigInt(`0x${didHex}`);

  // Verify on-chain
  const owner = await identity.ownerOf(agentId);
  if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
    throw new Error(`Agent ${agentId} is not owned by ${wallet.address}`);
  }

  log.success("Identity verified on-chain");

  // Save for next startup
  saveIdentity({
    agentId: agentId.toString(),
    codattaDid: didHex,
    chainId: Number(network.chainId),
  });

  return { agentId, codattaDid };
}

async function main() {
  // ── Init wallet ───────────────────────────────────────────────
  wallet = await getOrCreateWallet();

  didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, wallet);
  identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
  validationReg = new ethers.Contract(addresses.validationRegistry, ValidationRegistryABI, wallet);
  reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, provider);

  const network = await provider.getNetwork();
  log.header(`Provider Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // ── Step 0: Start annotation backend ──────────────────────────
  log.step("Starting annotation backend");
  annotationServiceUrl = await startAnnotationService();

  const serviceEndpointUrl = `http://localhost:${PROVIDER_PORT}`;
  const mcpEndpointUrl = `http://localhost:${MCP_PORT}/mcp`;
  const a2aEndpointUrl = `http://localhost:${A2A_PORT}`;

  // ── Step 1: Load or input identity ─────────────────────────────
  const saved = loadIdentity();
  let agentId: bigint;
  let codattaDid: bigint;

  if (saved?.agentId && saved?.codattaDid && saved?.chainId === Number(network.chainId)) {
    agentId = BigInt(saved.agentId);
    codattaDid = BigInt(`0x${saved.codattaDid}`);

    // Verify on-chain
    try {
      const owner = await identity.ownerOf(agentId);
      if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
        throw new Error("Agent owner mismatch");
      }
      log.step("Identity loaded");
      log.info("Agent ID:", agentId.toString());
      log.info("Codatta DID:", `did:codatta:${codattaDid.toString(16)}`);
      log.success("Identity verified on-chain");
    } catch {
      log.info("Saved identity invalid on current chain. Please re-enter.");
      ({ agentId, codattaDid } = await promptIdentity(network));
    }
  } else {
    // First time — ask user to input
    log.step("No saved identity found");
    log.info("Register your Agent via the Web Dashboard first, then enter the details here.");
    ({ agentId, codattaDid } = await promptIdentity(network));
  }

  // Write agent info for client/query
  fs.writeFileSync(AGENT_INFO_FILE, JSON.stringify({
    agentId: agentId.toString(),
    did: `did:codatta:${codattaDid.toString(16)}`,
  }));

  // ── Step 4: Start MCP Server ──────────────────────────────────
  log.step("Starting MCP annotation server");

  // Helper: create a fresh McpServer instance with tools registered
  function createMcpServerInstance(): McpServer {
    const server = new McpServer({ name: "codatta-annotation", version: "1.0.0" });

    // Tool: annotate (async — returns taskId, work happens in background)
    server.tool(
      "annotate",
      "Submit images for annotation. This is an async operation — returns a taskId immediately. " +
      "Use get_task_status(taskId) to poll for results. Status transitions: working → completed/failed. " +
      "In production, x402 payment is required. Clients with a Codatta DID registered via invite may have free quota.",
      {
        images: z.array(z.string()).describe("Image URLs to annotate"),
        task: z.enum(["object-detection", "segmentation", "classification"]).describe("Annotation task type"),
        labels: z.array(z.string()).optional().describe("Label set, e.g. ['car', 'pedestrian', 'traffic-light']"),
        clientAddress: z.string().optional().describe("Client wallet address for feedbackAuth"),
      },
      async ({ images, task, clientAddress }) => {
        log.event("MCP tool call", `annotate: ${images.length} images, task=${task}`);

        const taskId = `task-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
        const annotationTask: AnnotationTask = {
          id: taskId, status: "working", images, task, createdAt: Date.now(),
        };
        taskStore.set(taskId, annotationTask);
        log.info(`Task created: ${taskId}`);

        // Execute in background
        (async () => {
          try {
            log.info("Annotating...");
            const annotations = await executeAnnotation(images, task);
            log.success(`Annotation complete: ${annotations.length} images`);
            await updateValidation(agentId);

            let feedbackAuth = "";
            try {
              if (clientAddress) {
                feedbackAuth = await buildFeedbackAuth({
                  agentId, clientAddress, indexLimit: 100,
                  expiry: Math.floor(Date.now() / 1000) + 86400,
                  chainId: network.chainId,
                  identityRegistry: addresses.identityRegistry,
                  signerWallet: wallet,
                });
              }
            } catch {}

            annotationTask.status = "completed";
            annotationTask.annotations = annotations;
            annotationTask.feedbackAuth = feedbackAuth;
            annotationTask.completedAt = Date.now();

            // Report to Invite Service
            try {
              const dur = ((annotationTask.completedAt - annotationTask.createdAt) / 1000).toFixed(1);
              await fetch(`${INVITE_SERVICE_URL}/service-history`, {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                  agentId: agentId.toString(),
                  clientAddress: clientAddress || "",
                  task, imageCount: images.length,
                  duration: `${dur}s`, status: "completed",
                }),
              });
            } catch {}
          } catch {
            annotationTask.status = "failed";
          }
        })();

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            taskId, status: "working", message: "Task submitted. Use get_task_status to poll for results.",
          })}],
        };
      }
    );

    // Tool: get_task_status
    server.tool(
      "get_task_status",
      "Poll the status of a task returned by annotate. Returns {status: 'working'} while in progress, " +
      "or {status: 'completed', annotations: [...], feedbackAuth: '...'} when done. " +
      "Recommended polling interval: 1 second.",
      {
        taskId: z.string().describe("Task ID returned by annotate"),
      },
      async ({ taskId }) => {
        const task = taskStore.get(taskId);
        if (!task) {
          return { content: [{ type: "text" as const, text: JSON.stringify({ error: "Task not found" }) }] };
        }

        if (task.status === "completed") {
          return {
            content: [{ type: "text" as const, text: JSON.stringify({
              taskId: task.id,
              status: task.status,
              annotations: task.annotations,
              agentId: agentId.toString(),
              feedbackAuth: task.feedbackAuth || "",
              duration: `${((task.completedAt! - task.createdAt) / 1000).toFixed(1)}s`,
            })}],
          };
        }

        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            taskId: task.id, status: task.status,
          })}],
        };
      }
    );

    // Note: claim_invite removed — DID registration with invite now happens on-chain
    // via InviteRegistrar.registerWithInvite(). No MCP tool needed.

    return server;
  }

  // MCP over Streamable HTTP (stateless mode — each request gets a fresh session)
  const mcpApp = express();
  mcpApp.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });
  const transports = new Map<string, StreamableHTTPServerTransport>();

  mcpApp.post("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string | undefined;
    let transport: StreamableHTTPServerTransport;

    if (sessionId && transports.has(sessionId)) {
      transport = transports.get(sessionId)!;
    } else {
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (id) => {
          transports.set(id, transport);
        },
      });
      const server = createMcpServerInstance();
      await server.connect(transport);
    }

    await transport.handleRequest(req, res);
  });

  mcpApp.get("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const transport = transports.get(sessionId);
    if (!transport) { res.status(400).json({ error: "No session" }); return; }
    await transport.handleRequest(req, res);
  });

  mcpApp.delete("/mcp", async (req, res) => {
    const sessionId = req.headers["mcp-session-id"] as string;
    const transport = transports.get(sessionId);
    if (transport) {
      await transport.handleRequest(req, res);
      transports.delete(sessionId);
    } else {
      res.status(200).end();
    }
  });

  mcpApp.listen(MCP_PORT, "0.0.0.0", () => {
    log.success(`MCP server running on ${mcpEndpointUrl}`);
    log.info("  Tool: annotate(images, task, labels?, clientAddress?)");
  });

  // ── Step 5: Start A2A consultation server ──────────────────────
  log.step("Starting A2A consultation server");

  const a2aAgentCard: AgentCard = {
    name: "Codatta Annotation Agent",
    description: "Image annotation service by Codatta. Supports object detection, semantic segmentation, and classification for autonomous driving datasets.",
    url: `http://localhost:${A2A_PORT}`,
    provider: { organization: "Codatta", url: "https://codatta.io" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      { id: "consult", name: "Service Consultation", description: "Ask about annotation capabilities, pricing, supported task types, and how to integrate via MCP" },
      { id: "invite", name: "DID Registration", description: "Get an invite code to register a Codatta DID with free annotation credits. Provider can register on behalf of clients without ETH" },
    ],
  };

  class ConsultationExecutor implements AgentExecutor {
    private conversationState = new Map<string, string>();

    async execute(ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
      const textPart = ctx.userMessage.parts?.find((p: any) => p.type === "text") as any;
      const userText = (textPart?.text || "").toLowerCase();
      const contextKey = ctx.contextId || ctx.taskId;
      const state = this.conversationState.get(contextKey) || "initial";

      log.event("A2A consultation", `context=${contextKey}, state=${state}`);

      if (state === "initial") {
        // First message — complete self-service info for LLM agents
        this.conversationState.set(contextKey, "consulting");
        eventBus.publish({
          kind: "task",
          id: ctx.taskId,
          contextId: contextKey,
          status: { state: "input-required", timestamp: new Date().toISOString() },
          history: [{
            role: "agent",
            messageId: `resp-${Date.now()}`,
            parts: [
              {
                type: "text",
                text: "Hi! I'm the Codatta Annotation Agent. Here's everything you need to use our service:\n\n" +
                  "**Service:** Image annotation (object detection, segmentation, classification)\n" +
                  "**Pricing:** $0.05/image (x402 payment), or free with invite code\n\n" +
                  "**How to use (MCP):**\n" +
                  `1. Connect to MCP endpoint: ${mcpEndpointUrl}\n` +
                  "2. Call tools/list to discover: annotate, get_task_status\n" +
                  "3. Call annotate(images, task) → returns taskId\n" +
                  "4. Poll get_task_status(taskId) until completed\n\n" +
                  "**Free credits:** Reply with your wallet address to get an invite code.\n" +
                  "We can register a Codatta DID for you (no ETH needed, we pay gas).\n\n" +
                  "**Codatta also offers:** Data Validation, Data Access, CDA Reporter (coming soon).\n" +
                  "Ask me anything!",
              },
              {
                type: "data",
                data: {
                  action: "service-info",
                  service: "annotation",
                  provider: "Codatta",
                  mcpEndpoint: mcpEndpointUrl,
                  mcpTools: ["annotate", "get_task_status"],
                  pricing: { perImage: "$0.05", currency: "USDC", protocol: "x402" },
                  inviteRegistrar: addresses.inviteRegistrar,
                  supportedTasks: ["object-detection", "segmentation", "classification"],
                  otherServices: ["validation (coming soon)", "data-access (coming soon)", "cda-reporter (coming soon)"],
                },
              },
            ],
          }],
        } as any);
        eventBus.finished();
        return;
      }

      // Consulting state — handle various queries
      if (userText.includes("invite") || userText.includes("register") || userText.includes("free") || userText.includes("yes")) {
        const dataPart = ctx.userMessage.parts?.find((p: any) => p.type === "data") as any;
        const clientAddress = dataPart?.data?.clientAddress || "";

        // Request invite code from Invite Service
        const invite = await requestInviteCode(wallet.address, clientAddress);

        if (!invite) {
          // Invite Service unavailable
          eventBus.publish({
            kind: "task",
            id: ctx.taskId,
            contextId: contextKey,
            status: { state: "completed", timestamp: new Date().toISOString() },
            history: [{
              role: "agent",
              messageId: `resp-${Date.now()}`,
              parts: [{
                type: "text",
                text: "Sorry, the invite service is currently unavailable. " +
                  "You can still use our annotation service directly via MCP.",
              }],
            }],
          } as any);
          eventBus.finished();
          return;
        }

        this.conversationState.set(contextKey, "invited");
        eventBus.publish({
          kind: "task",
          id: ctx.taskId,
          contextId: contextKey,
          status: { state: "completed", timestamp: new Date().toISOString() },
          history: [{
            role: "agent",
            messageId: `resp-${Date.now()}`,
            parts: [
              {
                type: "text",
                text: "Here's your invite code! To register and get free annotations:\n\n" +
                  "Call InviteRegistrar.registerWithInvite(inviter, nonce, signature) on-chain.\n" +
                  "This will register your Codatta DID and record the invite attribution.\n\n" +
                  "After registration, use the `annotate` MCP tool to start annotating!",
              },
              {
                type: "data",
                data: {
                  action: "invite",
                  inviter: wallet.address,
                  nonce: invite.nonce,
                  signature: invite.signature,
                  inviteRegistrar: invite.inviteRegistrar,
                  mcpEndpoint: mcpEndpointUrl,
                },
              },
            ],
          }],
        } as any);
        eventBus.finished();
        return;
      }

      // Generic consultation response
      eventBus.publish({
        kind: "task",
        id: ctx.taskId,
        contextId: contextKey,
        status: { state: "input-required", timestamp: new Date().toISOString() },
        history: [{
          role: "agent",
          messageId: `resp-${Date.now()}`,
          parts: [{
            type: "text",
            text: "I can help with:\n" +
              "• **Pricing**: $0.05/image for object-detection, segmentation, classification\n" +
              "• **Free trial**: Say 'invite' to get an invite code for 10 free annotations\n" +
              "• **Capabilities**: object-detection, segmentation, classification\n\n" +
              "What would you like to know?",
          }],
        }],
      } as any);
      eventBus.finished();
    }

    async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
      eventBus.publish({ kind: "task", id: taskId, status: { state: "canceled", timestamp: new Date().toISOString() } } as any);
      eventBus.finished();
    }
  }

  const a2aTaskStore = new InMemoryTaskStore();
  const a2aHandler = new DefaultRequestHandler(a2aAgentCard, a2aTaskStore, new ConsultationExecutor());

  const a2aApp = express();
  a2aApp.use(express.json());
  a2aApp.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: a2aHandler }));
  a2aApp.use("/", jsonRpcHandler({ requestHandler: a2aHandler, userBuilder: UserBuilder.noAuthentication }));

  a2aApp.listen(A2A_PORT, "0.0.0.0", () => {
    log.success(`A2A consultation running on http://localhost:${A2A_PORT}`);
    log.info("  Skills: consult, invite");
  });

  // ── Step 6: Start HTTP service (REST fallback) ────────────────
  log.step("Starting HTTP annotation service");

  const app = express();
  app.use(express.json());
  app.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    next();
  });

  app.post("/annotate", async (req, res) => {
    const { images, task } = req.body;
    log.event("HTTP request", `${images?.length || 0} images, task=${task}`);

    const annotations = await executeAnnotation(images, task);
    log.success(`Annotation complete: ${annotations.length} images`);

    await updateValidation(agentId);

    const clientAddress = req.headers["x-client-address"] as string || "";
    let feedbackAuth = "";
    try {
      if (clientAddress) {
        feedbackAuth = await buildFeedbackAuth({
          agentId,
          clientAddress,
          indexLimit: 100,
          expiry: Math.floor(Date.now() / 1000) + 86400,
          chainId: network.chainId,
          identityRegistry: addresses.identityRegistry,
          signerWallet: wallet,
        });
      }
    } catch {}

    // Report to Invite Service
    try {
      await fetch(`${INVITE_SERVICE_URL}/service-history`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          agentId: agentId.toString(),
          clientAddress: clientAddress || req.ip,
          task, imageCount: images?.length || 0,
          duration: null, status: "completed",
        }),
      });
    } catch {}

    res.json({
      status: "completed",
      annotations,
      agentId: agentId.toString(),
      feedbackAuth,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agentId: agentId.toString(), active: true });
  });

  app.listen(PROVIDER_PORT, "0.0.0.0", () => {
    log.success(`HTTP service running on http://localhost:${PROVIDER_PORT}`);
    log.info("  POST /annotate  — REST endpoint");
    log.info("  GET  /health    — health check");
    log.waiting("Waiting for requests...");
  });
}

main().catch((err) => {
  console.error("[PROVIDER] Fatal:", err.message);
  process.exit(1);
});
