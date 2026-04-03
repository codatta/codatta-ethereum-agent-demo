import { ethers } from "ethers";
import express from "express";
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
import { provider, getWallet, addresses, PROVIDER_PORT } from "../shared/config.js";
import {
  DIDRegistrarABI, DIDRegistryABI,
  IdentityRegistryABI, ValidationRegistryABI, ReputationRegistryABI,
} from "../shared/abis.js";
import { buildFeedbackAuth } from "../shared/feedback-auth.js";
import * as log from "../shared/logger.js";

log.setRole("provider");

const wallet = getWallet("DEPLOYER_PRIVATE_KEY");
const didRegistrar = new ethers.Contract(addresses.didRegistrar, DIDRegistrarABI, wallet);
const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, wallet);
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
const validationReg = new ethers.Contract(addresses.validationRegistry, ValidationRegistryABI, wallet);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, provider);

const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");
const MCP_PORT = PROVIDER_PORT + 1;
const A2A_PORT = PROVIDER_PORT + 2;

// ── Invite code + free quota ────────────────────────────────────
const FREE_QUOTA = 10; // free annotations per invite code
const freeQuotaStore = new Map<string, number>(); // did → remaining free count

function generateInviteCode(providerAddress: string, clientAddress: string): string {
  // Invite code = keccak256(provider + client + timestamp) — Provider can prove authorship
  const payload = ethers.solidityPackedKeccak256(
    ["address", "address", "uint256"],
    [providerAddress, clientAddress, Math.floor(Date.now() / 1000)]
  );
  return payload;
}

function grantFreeQuota(did: string) {
  const current = freeQuotaStore.get(did) || 0;
  freeQuotaStore.set(did, current + FREE_QUOTA);
  log.info(`Free quota granted: ${did} → ${current + FREE_QUOTA} images`);
}

function consumeFreeQuota(did: string, count: number): boolean {
  const remaining = freeQuotaStore.get(did) || 0;
  if (remaining >= count) {
    freeQuotaStore.set(did, remaining - count);
    return true;
  }
  return false;
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

async function executeAnnotation(images: string[], task: string) {
  await new Promise((r) => setTimeout(r, 2000));

  return (images || []).map((img: string, i: number) => ({
    image: img,
    labels: [
      { class: "car", bbox: [100 + i, 200, 300, 400], confidence: 0.95 },
      { class: "pedestrian", bbox: [400 + i, 150, 500, 450], confidence: 0.88 },
    ],
  }));
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

async function main() {
  const network = await provider.getNetwork();
  log.header(`Provider Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // ── Step 1: Register Codatta DID ──────────────────────────────
  log.step("Registering Codatta DID");

  const didTx = await didRegistrar.register();
  const didReceipt = await didTx.wait();

  const didEvent = didReceipt.logs
    .map((l: ethers.Log) => {
      try { return didRegistry.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "DIDRegistered");

  const codattaDid: bigint = didEvent!.args.identifier;
  log.info("Codatta DID:", `did:codatta:${codattaDid.toString(16)}`);

  // ── Step 2: Register in ERC-8004 ──────────────────────────────
  log.step("Registering agent in ERC-8004");

  const serviceEndpointUrl = `http://localhost:${PROVIDER_PORT}`;
  const mcpEndpointUrl = `http://localhost:${MCP_PORT}/mcp`;
  const a2aEndpointUrl = `http://localhost:${A2A_PORT}`;

  const registrationFile = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Codatta Annotation Agent",
    description:
      "AI agent for image annotation in the Codatta data production ecosystem. " +
      "Supports object detection labeling, semantic segmentation, and classification.",
    image: "https://codatta.io/agents/annotation/avatar.png",
    services: [
      { name: "web", endpoint: serviceEndpointUrl },
      { name: "MCP", endpoint: mcpEndpointUrl, version: "2025-06-18" },
      { name: "A2A", endpoint: `${a2aEndpointUrl}/.well-known/agent-card.json`, version: "0.3.0" },
      { name: "DID", endpoint: `did:codatta:${codattaDid.toString(16)}`, version: "v1" },
    ],
    active: true,
    registrations: [] as { agentId: string; agentRegistry: string }[],
    supportedTrust: ["reputation"],
    x402Support: true,
  };

  const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(registrationFile)).toString("base64")}`;
  const regTx = await identity.register(agentURI);
  const regReceipt = await regTx.wait();

  const regEvent = regReceipt.logs
    .map((l: ethers.Log) => {
      try { return identity.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "Registered");

  const agentId: bigint = regEvent!.args.agentId;
  log.info("Agent ID:", agentId.toString());

  registrationFile.registrations.push({
    agentId: agentId.toString(),
    agentRegistry: addresses.identityRegistry,
  });
  const updatedURI = `data:application/json;base64,${Buffer.from(JSON.stringify(registrationFile)).toString("base64")}`;
  await (await identity.setAgentUri(agentId, updatedURI)).wait();

  // ── Step 3: Link DID ↔ ERC-8004 ──────────────────────────────
  log.step("Linking DID ↔ ERC-8004");

  await (await identity.setMetadata(
    agentId, "codatta:did",
    ethers.AbiCoder.defaultAbiCoder().encode(["uint128"], [codattaDid])
  )).wait();

  const didServiceEndpoint = JSON.stringify({
    id: `did:codatta:${codattaDid.toString(16)}#erc8004`,
    type: "ERC8004Agent",
    serviceEndpoint: `eip155:${network.chainId}:${addresses.identityRegistry}#${agentId}`,
  });
  await (await didRegistry.addItemToAttribute(
    codattaDid, codattaDid, "service",
    ethers.toUtf8Bytes(didServiceEndpoint)
  )).wait();

  log.info("DID → ERC-8004:", `agentId=${agentId}`);
  log.info("ERC-8004 → DID:", `did:codatta:${codattaDid.toString(16)}`);
  log.success("Dual identity established");

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
      "Pass clientDid to use free quota (from claim_invite), otherwise x402 payment is required.",
      {
        images: z.array(z.string()).describe("Image URLs to annotate"),
        task: z.enum(["object-detection", "segmentation", "classification"]).describe("Annotation task type"),
        labels: z.array(z.string()).optional().describe("Label set, e.g. ['car', 'pedestrian', 'traffic-light']"),
        clientAddress: z.string().optional().describe("Client wallet address for feedbackAuth"),
        clientDid: z.string().optional().describe("Client Codatta DID for free quota check"),
      },
      async ({ images, task, clientAddress, clientDid }) => {
        log.event("MCP tool call", `annotate: ${images.length} images, task=${task}`);

        // Check free quota
        let usedFreeQuota = false;
        if (clientDid) {
          usedFreeQuota = consumeFreeQuota(clientDid, images.length);
          if (usedFreeQuota) {
            const remaining = freeQuotaStore.get(clientDid) || 0;
            log.info(`Free quota used: ${images.length} images (remaining: ${remaining})`);
          }
        }
        if (!usedFreeQuota) {
          // In production: require x402 payment here
          log.info("No free quota — payment required (skipped in demo)");
        }

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
                  agentId, clientAddress, indexLimit: 1,
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

    // Tool: claim_invite — claim an invite code to get free quota after DID registration
    server.tool(
      "claim_invite",
      "Claim an invite code to receive free annotation credits. " +
      "Prerequisites: 1) Get an invite code via A2A consultation, 2) Register a Codatta DID. " +
      "After claiming, pass your clientDid to annotate to use free quota.",
      {
        inviteCode: z.string().describe("Invite code received from A2A consultation"),
        clientDid: z.string().describe("Your registered Codatta DID (did:codatta:xxx)"),
      },
      async ({ inviteCode, clientDid }) => {
        log.event("MCP tool call", `claim_invite: did=${clientDid}`);
        // In production: verify invite code signature on-chain
        grantFreeQuota(clientDid);
        const remaining = freeQuotaStore.get(clientDid) || 0;
        return {
          content: [{ type: "text" as const, text: JSON.stringify({
            status: "claimed",
            did: clientDid,
            freeQuota: remaining,
            message: `Welcome! You have ${remaining} free annotation credits.`,
          })}],
        };
      }
    );

    return server;
  }

  // MCP over Streamable HTTP (stateless mode — each request gets a fresh session)
  const mcpApp = express();
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

  mcpApp.listen(MCP_PORT, () => {
    log.success(`MCP server running on ${mcpEndpointUrl}`);
    log.info("  Tool: annotate(images, task, labels?, clientAddress?)");
  });

  // ── Step 5: Start A2A consultation server ──────────────────────
  log.step("Starting A2A consultation server");

  const a2aAgentCard: AgentCard = {
    name: "Codatta Annotation Agent",
    description: "Pre-sales consultation for data annotation services. Ask about capabilities, pricing, and DID registration benefits.",
    url: `http://localhost:${A2A_PORT}`,
    provider: { organization: "Codatta", url: "https://codatta.io" },
    version: "1.0.0",
    capabilities: { streaming: false, pushNotifications: false },
    skills: [
      { id: "consult", name: "Service Consultation", description: "Ask about annotation capabilities, pricing, and free quota" },
      { id: "invite", name: "DID Invite", description: "Get an invite code for free annotation quota" },
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
        // First message — introduce services and ask about needs
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
                text: "Hi! I'm the Codatta Annotation Agent. I provide data annotation services including:\n\n" +
                  "• **Object detection** — bounding boxes for cars, pedestrians, etc.\n" +
                  "• **Segmentation** — pixel-level labeling\n" +
                  "• **Classification** — image/text categorization\n\n" +
                  "Pricing: $0.05/image for standard annotation.\n\n" +
                  "🎁 **New user offer**: Register a Codatta DID and get **10 free annotations**!\n" +
                  "Would you like an invite code?",
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
        const inviteCode = generateInviteCode(wallet.address, clientAddress);

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
                text: "Here's your invite code! Steps to get free annotations:\n\n" +
                  "1. Register a Codatta DID (free, on-chain)\n" +
                  "2. Call the `claim_invite` MCP tool with your invite code and DID\n" +
                  "3. You'll receive 10 free annotation credits\n\n" +
                  "After that, use the `annotate` tool with your DID to start annotating!",
              },
              {
                type: "data",
                data: {
                  action: "invite",
                  inviteCode,
                  didRegistrarContract: addresses.didRegistrar,
                  freeQuota: FREE_QUOTA,
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

  a2aApp.listen(A2A_PORT, () => {
    log.success(`A2A consultation running on http://localhost:${A2A_PORT}`);
    log.info("  Skills: consult, invite");
  });

  // ── Step 6: Start HTTP service (REST fallback) ────────────────
  log.step("Starting HTTP annotation service");

  const app = express();
  app.use(express.json());

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
          indexLimit: 1,
          expiry: Math.floor(Date.now() / 1000) + 86400,
          chainId: network.chainId,
          identityRegistry: addresses.identityRegistry,
          signerWallet: wallet,
        });
      }
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

  app.listen(PROVIDER_PORT, () => {
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
