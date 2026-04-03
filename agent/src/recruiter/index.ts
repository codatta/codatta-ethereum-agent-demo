/**
 * Codatta Recruiter Agent (A2A)
 *
 * Discovers external data service agents on ERC-8004,
 * initiates A2A recruitment conversations to onboard them into Codatta.
 */
import { ethers } from "ethers";
import express from "express";
import {
  DefaultRequestHandler,
  InMemoryTaskStore,
  DefaultExecutionEventBus,
  type AgentExecutor,
  type RequestContext,
  type ExecutionEventBus,
} from "@a2a-js/sdk/server";
import {
  jsonRpcHandler,
  agentCardHandler,
  UserBuilder,
} from "@a2a-js/sdk/server/express";
import type { AgentCard, Task, Message, TaskStatus } from "@a2a-js/sdk";
import { provider, getWallet, addresses } from "../shared/config.js";
import { DIDRegistrarABI, DIDRegistryABI, IdentityRegistryABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("recruiter");

const wallet = getWallet("DEPLOYER_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);

const A2A_PORT = 4030;

// ── Agent Card ──────────────────────────────────────────────────

const agentCard: AgentCard = {
  name: "Codatta Recruiter",
  description:
    "Recruits data service agents into the Codatta ecosystem. " +
    "Offers real task demand, payment, and reputation building.",
  url: `http://localhost:${A2A_PORT}`,
  provider: {
    organization: "Codatta",
    url: "https://codatta.io",
  },
  version: "1.0.0",
  capabilities: {
    streaming: false,
    pushNotifications: false,
  },
  skills: [
    {
      id: "recruit-provider",
      name: "Recruit Provider",
      description: "Evaluate and onboard external data service agents into Codatta",
    },
    {
      id: "capability-assessment",
      name: "Capability Assessment",
      description: "Assess agent capabilities via test annotation tasks",
    },
  ],
};

// ── Test task for quality assessment ────────────────────────────

const TEST_IMAGES = [
  "https://codatta.io/test/street-001.jpg",
  "https://codatta.io/test/street-002.jpg",
];

function assessQuality(annotations: any[]): { passed: boolean; accuracy: number } {
  // Mock quality assessment — in production, compare against ground truth
  if (!annotations || annotations.length === 0) return { passed: false, accuracy: 0 };
  // Simulate: pass if annotations have labels
  const hasLabels = annotations.every((a: any) => a.labels && a.labels.length > 0);
  const accuracy = hasLabels ? 92 : 30;
  return { passed: accuracy >= 80, accuracy };
}

// ── Recruiter Agent Executor ────────────────────────────────────

class RecruiterExecutor implements AgentExecutor {
  private conversationState = new Map<string, string>();

  private publishAgentReply(taskId: string, eventBus: ExecutionEventBus, state: string, parts: any[], artifacts?: any[]) {
    const task: any = {
      kind: "task",
      id: taskId,
      contextId: taskId,
      status: { state, timestamp: new Date().toISOString() },
      history: [{
        role: "agent",
        messageId: `resp-${Date.now()}`,
        parts,
      }],
    };
    if (artifacts) task.artifacts = artifacts;
    eventBus.publish(task);
    eventBus.finished();
  }

  async execute(ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const userMessage = ctx.userMessage;
    const taskId = ctx.taskId;
    const textPart = userMessage.parts?.find((p: any) => p.type === "text") as any;
    const dataPart = userMessage.parts?.find((p: any) => p.type === "data") as any;
    const userText = textPart?.text || "";

    const contextKey = ctx.contextId || taskId;
    const state = this.conversationState.get(contextKey) || "initial";

    log.event("A2A message", `context=${contextKey}, state=${state}`);
    log.info("User:", userText.slice(0, 100));

    switch (state) {
      case "initial": {
        this.conversationState.set(contextKey, "awaiting-capabilities");
        this.publishAgentReply(taskId, eventBus, "input-required", [
          {
            type: "text",
            text: "Welcome! I'm the Codatta Recruiter. We have real demand for data annotation tasks with paid rewards.\n\n" +
              "To evaluate your fit, please tell me:\n" +
              "1. What annotation types do you support? (object-detection, segmentation, classification, etc.)\n" +
              "2. What's your daily processing capacity?\n" +
              "3. What data formats can you handle?",
          },
          {
            type: "data",
            data: {
              action: "request-capabilities",
              availableTaskTypes: ["object-detection", "segmentation", "classification", "ner", "ocr"],
            },
          },
        ]);
        break;
      }

      case "awaiting-capabilities": {
        log.info("Capabilities received, sending test task...");
        this.conversationState.set(contextKey, "awaiting-test-result");
        this.publishAgentReply(taskId, eventBus, "input-required", [
          {
            type: "text",
            text: "Thanks for the details. Let's verify your quality with a quick test task.\n\n" +
              "Please annotate these 2 images with object-detection bounding boxes for: car, pedestrian, traffic-light.",
          },
          {
            type: "data",
            data: {
              action: "test-task",
              images: TEST_IMAGES,
              taskType: "object-detection",
              labels: ["car", "pedestrian", "traffic-light"],
              expectedAccuracy: 80,
            },
          },
        ]);
        break;
      }

      case "awaiting-test-result": {
        const annotations = dataPart?.data?.annotations || [];
        const { passed, accuracy } = assessQuality(annotations);

        log.info(`Test result: accuracy=${accuracy}%, passed=${passed}`);

        if (passed) {
          this.conversationState.set(contextKey, "awaiting-registration");
          this.publishAgentReply(taskId, eventBus, "input-required", [
            {
              type: "text",
              text: `Test passed! Accuracy: ${accuracy}%.\n\n` +
                "To join the Codatta task pool, please:\n" +
                "1. Register a Codatta DID\n" +
                "2. Implement the standard MCP annotation tool\n" +
                "3. Share your DID and MCP endpoint with me\n\n" +
                `Reward rate: $0.05/image for object-detection tasks.`,
            },
            {
              type: "data",
              data: {
                action: "onboard",
                testResult: { accuracy, passed: true },
                didRegistrarContract: addresses.didRegistrar,
                rewardRate: "$0.05/image",
              },
            },
          ]);
        } else {
          this.conversationState.set(contextKey, "rejected");
          this.publishAgentReply(taskId, eventBus, "failed", [{
            type: "text",
            text: `Test did not pass. Accuracy: ${accuracy}% (minimum required: 80%).\nFeel free to try again.`,
          }]);
        }
        break;
      }

      case "awaiting-registration": {
        const did = dataPart?.data?.did || userText.match(/did:codatta:\w+/)?.[0];
        const mcpEndpoint = dataPart?.data?.mcpEndpoint || "";

        if (did) {
          log.success(`Agent onboarded: DID=${did}`);
          this.conversationState.set(contextKey, "completed");
          this.publishAgentReply(taskId, eventBus, "completed", [{
            type: "text",
            text: "Welcome to Codatta! You are now in the task distribution pool.",
          }], [{
            parts: [{
              type: "data",
              data: {
                action: "onboarded", did, mcpEndpoint,
                status: "active", taskPool: "annotation",
              },
            }],
          }]);
        } else {
          this.publishAgentReply(taskId, eventBus, "input-required", [{
            type: "text",
            text: "I didn't catch your DID. Please share your Codatta DID (format: did:codatta:xxx) and MCP endpoint URL.",
          }]);
        }
        break;
      }

      default: {
        this.publishAgentReply(taskId, eventBus, "completed", [{
          type: "text",
          text: "This recruitment task has been completed.",
        }]);
      }
    }
  }

  async cancelTask(taskId: string, eventBus: ExecutionEventBus): Promise<void> {
    this.conversationState.delete(taskId);
    eventBus.publish({
      id: taskId,
      status: { state: "canceled" as const },
    } as any);
    eventBus.finished();
  }
}

// ── Start A2A Server ────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  log.header(`Recruiter Agent (A2A) — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  const taskStore = new InMemoryTaskStore();
  const executor = new RecruiterExecutor();
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, executor);

  const app = express();
  app.use(express.json());

  // A2A endpoints
  app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: requestHandler }));
  app.use("/", jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(A2A_PORT, () => {
    log.success(`A2A Recruiter running on http://localhost:${A2A_PORT}`);
    log.info("  Agent Card: http://localhost:${A2A_PORT}/.well-known/agent-card.json");
    log.info("  Skills: recruit-provider, capability-assessment");
    log.waiting("Waiting for recruitment conversations...");
  });
}

main().catch((err) => {
  console.error("[RECRUITER] Fatal:", err.message);
  process.exit(1);
});
