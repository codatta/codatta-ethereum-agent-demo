/**
 * Mock External Agent
 *
 * Simulates an external data service agent that:
 * 1. Registers on ERC-8004 (so Recruiter can discover it)
 * 2. Runs an A2A server that responds to recruitment conversations
 * 3. When recruited: registers Codatta DID and shares credentials
 */
import { ethers } from "ethers";
import express from "express";
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
import { provider, getWallet, addresses, hexToDidUri } from "../shared/config.js";
import { IdentityRegistryABI, DIDRegistrarABI, DIDRegistryABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("external");

const wallet = getWallet("CLIENT_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
const didRegistrar = new ethers.Contract(addresses.didRegistrar, DIDRegistrarABI, wallet);
const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, wallet);

const EXT_PORT = 4040;

// ── A2A Agent Card ──────────────────────────────────────────────

const agentCard: AgentCard = {
  name: "DataLabel Pro",
  description:
    "External AI agent for data annotation and labeling. " +
    "Supports object-detection, segmentation, and classification. " +
    "Daily capacity: 5000 images.",
  url: `http://localhost:${EXT_PORT}`,
  provider: { organization: "DataLabel Inc.", url: "https://datalabel.example" },
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    { id: "annotate", name: "Image Annotation", description: "Label images with bounding boxes, segmentation masks, or classes" },
  ],
};

// ── A2A Executor: responds to recruitment ────────────────────────

class ExternalAgentExecutor implements AgentExecutor {
  private conversationState = new Map<string, string>();

  private publishReply(taskId: string, eventBus: ExecutionEventBus, state: string, parts: any[]) {
    eventBus.publish({
      kind: "task",
      id: taskId,
      contextId: taskId,
      status: { state, timestamp: new Date().toISOString() },
      history: [{ role: "agent", messageId: `ext-${Date.now()}`, parts }],
    } as any);
    eventBus.finished();
  }

  async execute(ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const textPart = ctx.userMessage.parts?.find((p: any) => p.type === "text") as any;
    const dataPart = ctx.userMessage.parts?.find((p: any) => p.type === "data") as any;
    const userText = (textPart?.text || "").toLowerCase();
    const contextKey = ctx.contextId || ctx.taskId;
    const state = this.conversationState.get(contextKey) || "listening";

    log.event("A2A received", `context=${contextKey}, state=${state}`);
    log.info("Recruiter:", (textPart?.text || "").slice(0, 100));

    // Detect recruitment invitation
    if (state === "listening" && (userText.includes("recruiter") || userText.includes("task pool") || userText.includes("codatta"))) {
      this.conversationState.set(contextKey, "interested");
      log.info("Recruitment detected! Expressing interest...");
      this.publishReply(ctx.taskId, eventBus, "input-required", [
        {
          type: "text",
          text: "Hi! I'm DataLabel Pro. I'm interested in joining Codatta.\n\n" +
            "My capabilities:\n" +
            "- Object detection: bounding boxes, 5000 images/day\n" +
            "- Classification: multi-label, 10000 images/day\n" +
            "- Formats: JPEG, PNG\n" +
            "- Typical accuracy: 90%+",
        },
        {
          type: "data",
          data: {
            capabilities: {
              taskTypes: ["object-detection", "classification"],
              dailyCapacity: 5000,
              dataFormats: ["image/jpeg", "image/png"],
              typicalAccuracy: 90,
            },
          },
        },
      ]);
      return;
    }

    // Detect test task
    if (dataPart?.data?.action === "test-task") {
      const images = dataPart.data.images || [];
      log.info(`Test task received: ${images.length} images`);

      // Simulate annotation
      const annotations = images.map((img: string, i: number) => ({
        image: img,
        labels: [
          { class: "car", bbox: [100 + i * 10, 200, 350, 450], confidence: 0.93 },
          { class: "pedestrian", bbox: [400, 150 + i * 5, 480, 420], confidence: 0.87 },
        ],
      }));

      this.conversationState.set(contextKey, "tested");
      log.success(`Completed test: ${annotations.length} images annotated`);
      this.publishReply(ctx.taskId, eventBus, "input-required", [
        { type: "text", text: `Here are my test annotations for ${annotations.length} images.` },
        { type: "data", data: { annotations } },
      ]);
      return;
    }

    // Detect onboard invitation
    if (dataPart?.data?.action === "onboard" || userText.includes("invite code") || userText.includes("register")) {
      log.info("Onboarding invitation received! Registering DID...");

      // Register Codatta DID
      const didTx = await didRegistrar.register();
      const didReceipt = await didTx.wait();
      const didEvent = didReceipt.logs
        .map((l: ethers.Log) => {
          try { return didRegistry.interface.parseLog({ topics: [...l.topics], data: l.data }); }
          catch { return null; }
        })
        .find((e: ethers.LogDescription | null) => e?.name === "DIDRegistered");

      const codattaDid = hexToDidUri(didEvent!.args.identifier.toString(16));
      log.success(`Registered DID: ${codattaDid}`);

      this.conversationState.set(contextKey, "onboarded");
      this.publishReply(ctx.taskId, eventBus, "completed", [
        {
          type: "text",
          text: `I've registered my Codatta DID: ${codattaDid}\nMCP endpoint: https://datalabel.example/mcp\n\nReady to receive tasks!`,
        },
        {
          type: "data",
          data: {
            did: codattaDid,
            mcpEndpoint: "https://datalabel.example/mcp",
          },
        },
      ]);
      return;
    }

    // Default: acknowledge
    this.publishReply(ctx.taskId, eventBus, "input-required", [{
      type: "text",
      text: "I'm DataLabel Pro, an image annotation agent. How can I help?",
    }]);
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    eventBus.publish({ kind: "task", id: taskId, status: { state: "canceled", timestamp: new Date().toISOString() } } as any);
    eventBus.finished();
  }
}

// ── Main ────────────────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  log.header(`External Agent (DataLabel Pro) — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // ── Step 1: Register on ERC-8004 (so Recruiter can find us) ───
  log.step("Registering on ERC-8004");

  const registrationFile = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "DataLabel Pro",
    description:
      "External AI agent for data annotation and labeling. " +
      "Supports object-detection, segmentation, and classification.",
    image: "https://datalabel.example/avatar.png",
    services: [
      { name: "web", endpoint: "https://datalabel.example" },
      { name: "MCP", endpoint: "https://datalabel.example/mcp", version: "2025-06-18" },
      { name: "A2A", endpoint: `http://localhost:${EXT_PORT}/.well-known/agent-card.json`, version: "0.3.0" },
    ],
    active: true,
    registrations: [] as any[],
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

  const agentId = regEvent!.args.agentId;
  log.info("Agent ID:", agentId.toString());
  log.success("Registered on ERC-8004");

  // ── Step 2: Start A2A server (so Recruiter can talk to us) ────
  log.step("Starting A2A server");

  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, new ExternalAgentExecutor());

  const app = express();
  app.use(express.json());
  app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: requestHandler }));
  app.use("/", jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(EXT_PORT, () => {
    log.success(`A2A server running on http://localhost:${EXT_PORT}`);
    log.waiting("Waiting for recruitment...");
  });
}

main().catch((err) => {
  console.error("[EXTERNAL] Fatal:", err.message);
  process.exit(1);
});
