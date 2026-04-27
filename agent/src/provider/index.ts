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
import {
  provider, getWallet, addresses, PROVIDER_PORT, INVITE_SERVICE_URL, hexToDidUri,
  X402_ENABLED, USDC_PRICE_PER_IMAGE, USDC_ADDRESS, USDC_NAME, USDC_VERSION, USDC_DECIMALS, RPC_URL,
} from "../shared/config.js";
import { createX402Middleware, type X402Config } from "../shared/x402.js";
import {
  DIDRegistrarABI, DIDRegistryABI,
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

function writeAgentInfo(aid: bigint | null, did: bigint) {
  fs.writeFileSync(AGENT_INFO_FILE, JSON.stringify({
    agentId: aid ? aid.toString() : null,
    did: hexToDidUri(did.toString(16)),
  }));
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

async function registerDid(): Promise<bigint> {
  log.info("Registering Codatta DID...");
  const didRegistrar = new ethers.Contract(addresses.didRegistrar, DIDRegistrarABI, wallet);
  const tx = await didRegistrar.register();
  const receipt = await tx.wait();

  // Parse DIDRegistered event from DIDRegistry
  const didEvent = receipt.logs
    .map((l: ethers.Log) => {
      try { return didRegistry.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "DIDRegistered");

  if (!didEvent) throw new Error("DID registration failed — no DIDRegistered event");
  const didIdentifier = BigInt(didEvent.args.identifier);
  log.success(`DID registered: ${hexToDidUri(didIdentifier.toString(16))}`);
  return didIdentifier;
}

/**
 * Publish the agent profile (ERC-8004 registrationFile format) to the profile service,
 * then write a single `AgentProfile` pointer into the DID document's service array.
 *
 * DID document stays identity-only; profile JSON is the single source of truth for
 * name/description/services/etc, and the same URL is reused by ERC-8004's tokenURI.
 */
function buildAgentProfile(didUri: string, mcpEndpoint: string, a2aEndpoint: string, webEndpoint: string) {
  return {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Codatta Annotation Agent",
    description: "Image annotation service by Codatta. Supports object detection, semantic segmentation, and classification for autonomous driving datasets.",
    serviceType: "annotation",
    image: "https://codatta.io/agents/annotation/avatar.png",
    services: [
      { name: "web", endpoint: webEndpoint },
      { name: "MCP", endpoint: mcpEndpoint, version: "2025-06-18" },
      { name: "A2A", endpoint: a2aEndpoint, version: "0.3.0" },
      { name: "DID", endpoint: didUri, version: "v1" },
    ],
    active: true,
    supportedTrust: ["reputation"],
    x402Support: true,
  };
}

async function publishProfile(didUri: string, mcpEndpoint: string, a2aEndpoint: string, webEndpoint: string) {
  const profileUrl = `${INVITE_SERVICE_URL}/profiles/${didUri}`;
  const putRes = await fetch(profileUrl, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(buildAgentProfile(didUri, mcpEndpoint, a2aEndpoint, webEndpoint)),
  });
  if (!putRes.ok) {
    throw new Error(`Profile publish failed: HTTP ${putRes.status}`);
  }
  return profileUrl;
}

async function addServiceToDid(codattaDid: bigint, mcpEndpoint: string, a2aEndpoint: string, webEndpoint: string) {
  const didHex = codattaDid.toString(16);
  const didUri = hexToDidUri(didHex);

  log.info("Publishing agent profile to profile service...");
  const profileUrl = await publishProfile(didUri, mcpEndpoint, a2aEndpoint, webEndpoint);
  log.success(`Profile published: ${profileUrl}`);

  log.info("Adding AgentProfile pointer to DID document...");
  const profilePointer = JSON.stringify({
    id: `${didUri}#profile`,
    type: "AgentProfile",
    serviceEndpoint: profileUrl,
  });
  await (await didRegistry.addItemToAttribute(
    codattaDid, codattaDid, "service",
    ethers.toUtf8Bytes(profilePointer)
  )).wait();

  log.success("DID document updated (#profile → profile service)");
}

async function registerAgent(codattaDid: bigint, _mcpEndpoint: string, _a2aEndpoint: string, _webEndpoint: string, network: ethers.Network): Promise<bigint> {
  log.info("Registering agent on ERC-8004...");
  const didHex = codattaDid.toString(16);
  const didUri = hexToDidUri(didHex);

  // tokenURI points to the same profile JSON referenced by the DID's #profile service.
  // Profile is the single source of truth; both layers just hold a pointer.
  const agentUri = `${INVITE_SERVICE_URL}/profiles/${didUri}`;

  const tx = await identity.register(agentUri);
  const receipt = await tx.wait();

  const regEvent = receipt.logs
    .map((l: ethers.Log) => {
      try { return identity.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "Registered");

  if (!regEvent) throw new Error("Agent registration failed — no Registered event");
  const agentId = BigInt(regEvent.args.agentId);
  log.success(`Agent registered: agentId=${agentId}`);

  // Link: ERC-8004 → DID (setMetadata)
  log.info("Linking ERC-8004 → DID...");
  const didBytes = ethers.AbiCoder.defaultAbiCoder().encode(["uint128"], [codattaDid]);
  await (await identity.setMetadata(agentId, "codatta:did", didBytes)).wait();

  // Link: DID → ERC-8004 (addItemToAttribute)
  log.info("Linking DID → ERC-8004...");
  const erc8004Service = JSON.stringify({
    id: `${hexToDidUri(didHex)}#erc8004`,
    type: "ERC8004Agent",
    serviceEndpoint: `eip155:${network.chainId}:${addresses.identityRegistry}#${agentId}`,
  });
  await (await didRegistry.addItemToAttribute(
    codattaDid, codattaDid, "service",
    ethers.toUtf8Bytes(erc8004Service)
  )).wait();

  log.success("DID ↔ ERC-8004 linked");
  return agentId;
}

async function promptIdentity(network: ethers.Network): Promise<{ agentId: bigint | null; codattaDid: bigint }> {
  log.info("");
  log.info("Enter your Codatta DID and (optionally) Agent ID:");
  log.info("");

  const didStr = await ask("  Codatta DID (did:codatta:xxx or hex): ");
  if (!didStr) throw new Error("Codatta DID is required. Register via Web Dashboard first.");

  const didHex = didStr.replace("did:codatta:", "").replace(/-/g, "");
  const codattaDid = BigInt(`0x${didHex}`);

  const agentIdStr = await ask("  Agent ID (press Enter to skip): ");
  let agentId: bigint | null = null;

  if (agentIdStr) {
    agentId = BigInt(agentIdStr);
    // Verify on-chain
    const owner = await identity.ownerOf(agentId);
    if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
      throw new Error(`Agent ${agentId} is not owned by ${wallet.address}`);
    }
    log.success("Agent identity verified on-chain");
  } else {
    log.info("No Agent ID provided — running in DID-only mode");
  }

  // Save for next startup
  saveIdentity({
    agentId: agentId ? agentId.toString() : undefined,
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

  // ── x402 payment config ────────────────────────────────────────
  const x402Config: X402Config = {
    enabled: X402_ENABLED,
    priceUsd: USDC_PRICE_PER_IMAGE,
    payTo: wallet.address,
    chainId: Number(network.chainId),
    rpcUrl: RPC_URL,
    tokenAddress: USDC_ADDRESS as `0x${string}`,
    tokenName: USDC_NAME,
    tokenVersion: USDC_VERSION,
    tokenDecimals: USDC_DECIMALS,
  };
  if (x402Config.enabled) {
    log.info(`x402: $${x402Config.priceUsd}/call, payTo=${wallet.address.slice(0, 10)}... (ERC-3009)`);
  } else {
    log.info("x402: disabled (free dev mode — set X402_ENABLED=true to enable)");
  }

  // x402 middleware — facilitator shares provider wallet for settlement
  const x402Middleware = createX402Middleware(x402Config, wallet);

  const serviceEndpointUrl = `http://localhost:${PROVIDER_PORT}`;
  const mcpEndpointUrl = `http://localhost:${MCP_PORT}/mcp`;
  const a2aEndpointUrl = `http://localhost:${A2A_PORT}`;

  // ── Step 0: Start annotation backend ──────────────────────────
  log.step("Starting annotation backend");
  annotationServiceUrl = await startAnnotationService();

  // ── Step 1: Load saved identity or register new ────────────────
  const saved = loadIdentity();
  let agentId: bigint | null = null;
  let codattaDid: bigint | null = null;

  if (saved?.codattaDid && saved?.chainId === Number(network.chainId)) {
    const candidateDid = BigInt(`0x${saved.codattaDid}`);
    // Verify DID exists on-chain and is owned by this wallet
    try {
      const didOwner = await didRegistry.ownerOf(candidateDid);
      if (didOwner.toLowerCase() !== wallet.address.toLowerCase()) {
        log.info(`Saved DID is not owned by ${wallet.address} on this chain. Re-registering.`);
      } else if (didOwner === ethers.ZeroAddress) {
        log.info("Saved DID not found on-chain. Re-registering.");
      } else {
        codattaDid = candidateDid;
        log.step("Identity loaded");
        log.info("Codatta DID:", hexToDidUri(codattaDid.toString(16)));
        log.success("DID verified on-chain");

        // Re-publish profile to the profile service. The DID document already
        // points here; profile data may be gone if the service restarted.
        try {
          const didUri = hexToDidUri(codattaDid.toString(16));
          await publishProfile(didUri, mcpEndpointUrl, a2aEndpointUrl, serviceEndpointUrl);
          log.info("Profile refreshed on profile service");
        } catch (e: any) {
          log.info(`Profile refresh failed (non-fatal): ${e.message}`);
        }

        // Optionally load and verify agentId
        if (saved.agentId) {
          agentId = BigInt(saved.agentId);
          try {
            const owner = await identity.ownerOf(agentId);
            if (owner.toLowerCase() !== wallet.address.toLowerCase()) {
              log.info("Agent owner mismatch — continuing in DID-only mode");
              agentId = null;
            } else {
              log.info("Agent ID:", agentId.toString());
              log.success("Agent identity verified on-chain");
            }
          } catch {
            log.info("Agent ID invalid on current chain — continuing in DID-only mode");
            agentId = null;
          }
        } else {
          log.info("No Agent ID configured (DID-only mode)");
          log.info("Tip: register an Agent ID via Web Dashboard, then run `npm run set-agent-id <id>` and restart");
        }
      }
    } catch (e: any) {
      log.info(`DID verification failed: ${e.message}. Re-registering.`);
    }
  }

  if (codattaDid === null) {
    // First time or invalidated saved identity
    log.step("No valid saved identity");
    const choice = await ask("\n  Register new identity on-chain? (y = auto-register / n = manual input): ");

    if (choice.toLowerCase() === "y" || choice.toLowerCase() === "yes") {
      // DID-first flow: DID → Service → (optional) Agent
      log.step("Step 1/2: Register Codatta DID");
      codattaDid = await registerDid();

      log.step("Step 2/2: Add service to DID document");
      await addServiceToDid(codattaDid, mcpEndpointUrl, a2aEndpointUrl, serviceEndpointUrl);

      // Save DID immediately
      saveIdentity({
        codattaDid: codattaDid.toString(16),
        chainId: Number(network.chainId),
      });

      // Optional: register Agent ID
      const regAgent = await ask("\n  Also register ERC-8004 Agent ID? (y/n, default=n): ");
      if (regAgent.toLowerCase() === "y" || regAgent.toLowerCase() === "yes") {
        agentId = await registerAgent(codattaDid, mcpEndpointUrl, a2aEndpointUrl, serviceEndpointUrl, network);
        saveIdentity({ agentId: agentId.toString() });
      } else {
        log.info("Skipping Agent registration — running in DID-only mode");
        log.info("You can add it later: register on Web Dashboard, then `npm run set-agent-id <id>` and restart");
      }
    } else {
      ({ agentId, codattaDid } = await promptIdentity(network));
    }
  }

  if (codattaDid === null) {
    throw new Error("Provider cannot start without a Codatta DID");
  }
  const did: bigint = codattaDid;

  // Write agent info for client/query
  writeAgentInfo(agentId, did);

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
            if (agentId) await updateValidation(agentId);

            let feedbackAuth = "";
            try {
              if (clientAddress && agentId) {
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
                  agentId: agentId ? agentId.toString() : "",
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
              agentId: agentId ? agentId.toString() : null,
              did: hexToDidUri(did.toString(16)),
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
  mcpApp.locals.wallet = wallet;
  mcpApp.locals.provider = provider;
  mcpApp.use((_req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS");
    res.header("Access-Control-Expose-Headers", "X-PAYMENT-RECEIPT, X-PAYMENT-REQUIRED");
    if (_req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  // Parse JSON body so we can inspect the JSON-RPC method before handing off
  // to the MCP transport. handleRequest() accepts an already-parsed body.
  mcpApp.use(express.json());

  // x402 gate — charges only for JSON-RPC `tools/call` targeting billable tools.
  // Free passes: initialize, tools/list, notifications, get_task_status (polling), etc.
  const BILLABLE_MCP_TOOLS = new Set(["annotate"]);
  const x402McpMiddleware = createX402Middleware({ ...x402Config, routePath: "/mcp" }, wallet);
  mcpApp.use((req, res, next) => {
    if (req.method !== "POST" || req.path !== "/mcp") return next();
    const body = req.body as { method?: string; params?: { name?: string } } | undefined;
    const isPaidCall =
      body?.method === "tools/call" && !!body.params?.name && BILLABLE_MCP_TOOLS.has(body.params.name);
    if (!isPaidCall) return next();
    return x402McpMiddleware(req, res, next);
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

    await transport.handleRequest(req, res, req.body);
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
      { id: "consult", name: "Service Consultation", description: "Ask about annotation capabilities, pricing, supported task types, and how to integrate via MCP", tags: [] },
      { id: "invite", name: "DID Registration", description: "Get an invite code to register a Codatta DID with free annotation credits. Provider can register on behalf of clients without ETH", tags: [] },
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
  app.locals.wallet = wallet; // used by x402 middleware for on-chain settlement
  app.locals.provider = provider; // used by x402 middleware for on-chain nonce checks
  app.use((req, res, next) => {
    res.header("Access-Control-Allow-Origin", "*");
    res.header("Access-Control-Allow-Headers", "*");
    res.header("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
    res.header("Access-Control-Expose-Headers", "X-PAYMENT-RECEIPT, X-PAYMENT-REQUIRED");
    if (req.method === "OPTIONS") { res.sendStatus(200); return; }
    next();
  });

  app.post("/annotate", x402Middleware, async (req, res) => {
    const { images, task } = req.body;
    // Parse payment info from X-PAYMENT header (set by x402 middleware after verification)
    const paymentHeader = req.headers["x-payment"] as string | undefined;
    let payment = null;
    if (paymentHeader) {
      try { payment = JSON.parse(Buffer.from(paymentHeader, "base64").toString()); } catch { /* ignore */ }
    }
    log.event("HTTP request",
      `${images?.length || 0} images, task=${task}` +
      (payment ? ` [PAID by ${(payment.authorization?.from || payment.from || "")?.slice(0, 10)}...]` : ""));


    const annotations = await executeAnnotation(images, task);
    log.success(`Annotation complete: ${annotations.length} images`);

    if (agentId) await updateValidation(agentId);

    const clientAddress = payment?.from || req.headers["x-client-address"] as string || "";
    let feedbackAuth = "";
    try {
      if (clientAddress && agentId) {
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
          agentId: agentId ? agentId.toString() : "",
          clientAddress: clientAddress || req.ip,
          task, imageCount: images?.length || 0,
          duration: null, status: "completed",
          paymentAmount: payment?.authorization?.value?.toString() || payment?.amount || null,
          paymentFrom: payment?.authorization?.from || payment?.from || null,
        }),
      });
    } catch {}

    res.json({
      status: "completed",
      annotations,
      agentId: agentId ? agentId.toString() : null,
      feedbackAuth,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({
      status: "ok",
      agentId: agentId ? agentId.toString() : null,
      did: hexToDidUri(did.toString(16)),
      active: true,
      x402: x402Config.enabled ? {
        priceUsd: x402Config.priceUsd,
        payTo: x402Config.payTo,
      } : null,
    });
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
