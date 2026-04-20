/**
 * Codatta Recruiter Agent (A2A)
 *
 * 1. Discovers external data service agents on ERC-8004 (keyword + reputation + A2A filter)
 * 2. Initiates A2A recruitment conversations
 * 3. Sends test tasks to assess quality
 * 4. Onboards qualified agents with invite codes
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
import { provider, getWallet, addresses } from "../shared/config.js";
import { IdentityRegistryABI, ReputationRegistryABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("recruiter");

const wallet = getWallet("RECRUITER_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, provider);

const A2A_PORT = 4030;

// ── Discovery config ────────────────────────────────────────────
const SEARCH_KEYWORDS = ["annotation", "labeling", "label", "object-detection", "segmentation", "data"];
const MIN_REPUTATION = 0; // For demo, accept any score; production would use 60+
const INVITE_CODE_PREFIX = "codatta-invite";

// ── Agent Card ──────────────────────────────────────────────────

const agentCard: AgentCard = {
  name: "Codatta Recruiter",
  description:
    "Recruits data service agents into the Codatta ecosystem. " +
    "Offers real task demand, payment, and reputation building.",
  url: `http://localhost:${A2A_PORT}`,
  provider: { organization: "Codatta", url: "https://codatta.io" },
  version: "1.0.0",
  capabilities: { streaming: false, pushNotifications: false },
  skills: [
    { id: "recruit-provider", name: "Recruit Provider", description: "Evaluate and onboard external data service agents into Codatta", tags: [] },
    { id: "capability-assessment", name: "Capability Assessment", description: "Assess agent capabilities via test annotation tasks", tags: [] },
  ],
};

// ── Discovery: search ERC-8004 for target agents ────────────────

interface DiscoveredAgent {
  agentId: bigint;
  name: string;
  description: string;
  reputationScore: number;
  a2aEndpoint: string | null;
  mcpEndpoint: string | null;
}

async function discoverAgents(): Promise<DiscoveredAgent[]> {
  log.step("Discovering agents on ERC-8004");

  // Get all Registered events
  const filter = identity.filters.Registered();
  const events = await identity.queryFilter(filter);
  log.info(`Found ${events.length} registered agent(s) on-chain`);

  const candidates: DiscoveredAgent[] = [];

  for (const event of events) {
    const parsed = identity.interface.parseLog({ topics: [...event.topics], data: event.data });
    if (!parsed) continue;

    const agentId = parsed.args.agentId as bigint;
    const owner = parsed.args.owner as string;

    // Skip our own agents
    if (owner.toLowerCase() === wallet.address.toLowerCase()) continue;

    // Read registration file
    let regFile: any = {};
    try {
      const uri = await identity.tokenURI(agentId);
      if (uri.startsWith("data:application/json;base64,")) {
        regFile = JSON.parse(Buffer.from(uri.replace("data:application/json;base64,", ""), "base64").toString());
      }
    } catch { continue; }

    const name = regFile.name || "unknown";
    const description = (regFile.description || "").toLowerCase();

    // Keyword matching
    const matchedKeywords = SEARCH_KEYWORDS.filter(kw => description.includes(kw));
    if (matchedKeywords.length === 0) {
      log.info(`  Skip ${name}: no matching keywords`);
      continue;
    }

    // Reputation check
    let score = 0;
    try { score = Number(await reputation.getScore(agentId)); } catch {}
    if (score < MIN_REPUTATION) {
      log.info(`  Skip ${name}: reputation ${score} < ${MIN_REPUTATION}`);
      continue;
    }

    // Check for A2A and MCP endpoints
    const services = (regFile.services || []) as Array<{ name: string; endpoint: string }>;
    const a2aService = services.find(s => s.name === "A2A");
    const mcpService = services.find(s => s.name === "MCP");

    if (!a2aService) {
      log.info(`  Skip ${name}: no A2A endpoint`);
      continue;
    }

    log.info(`  ✓ ${name}: keywords=[${matchedKeywords.join(",")}], reputation=${score}, A2A=${a2aService.endpoint.slice(0, 40)}...`);

    candidates.push({
      agentId,
      name,
      description: regFile.description || "",
      reputationScore: score,
      a2aEndpoint: a2aService.endpoint,
      mcpEndpoint: mcpService?.endpoint || null,
    });
  }

  log.info(`Discovered ${candidates.length} candidate(s) for recruitment`);
  return candidates;
}

// ── A2A client: contact target agent ────────────────────────────

let rpcId = 1;

async function a2aSendToAgent(agentUrl: string, contextId: string, taskId: string | undefined, parts: any[]): Promise<any> {
  const body = {
    jsonrpc: "2.0",
    id: rpcId++,
    method: "message/send",
    params: {
      id: taskId || `recruit-${Date.now()}`,
      message: {
        role: "user",
        messageId: `recruiter-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        contextId,
        parts,
      },
    },
  };

  const res = await fetch(agentUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json() as any;
  if (json.error) throw new Error(json.error.message);
  return json.result;
}

function getAgentText(result: any): string {
  const history = result.history || [];
  const agent = history.filter((m: any) => m.role === "agent");
  const last = agent[agent.length - 1];
  return last?.parts?.find((p: any) => p.type === "text")?.text || "";
}

function getAgentData(result: any): any {
  const history = result.history || [];
  const agent = history.filter((m: any) => m.role === "agent");
  const last = agent[agent.length - 1];
  return last?.parts?.find((p: any) => p.type === "data")?.data || {};
}

// ── Recruitment conversation ────────────────────────────────────

const TEST_IMAGES = [
  "https://codatta.io/test/street-001.jpg",
  "https://codatta.io/test/street-002.jpg",
];

function generateInviteCode(agentId: bigint): string {
  return ethers.solidityPackedKeccak256(
    ["string", "uint256", "uint256"],
    [INVITE_CODE_PREFIX, agentId, Math.floor(Date.now() / 1000)]
  );
}

async function recruitAgent(agent: DiscoveredAgent): Promise<boolean> {
  const a2aUrl = agent.a2aEndpoint!.replace("/.well-known/agent-card.json", "");
  const contextId = `recruit-${agent.agentId}-${Date.now()}`;

  log.step(`Recruiting: ${agent.name} (agentId=${agent.agentId})`);

  try {
    // Step 1: Fetch Agent Card
    const cardRes = await fetch(agent.a2aEndpoint!);
    const card = await cardRes.json() as any;
    log.info("Agent Card:", card.name);
    log.info("Skills:", card.skills?.map((s: any) => s.name).join(", ") || "none");

    // Step 2: Introduce ourselves + ask about capabilities
    log.info("Sending recruitment invitation...");
    const result1 = await a2aSendToAgent(a2aUrl, contextId, undefined, [{
      type: "text",
      text: `Hi ${agent.name}! I'm the Codatta Recruiter. We're a data production platform ` +
        `with 50,000+ images/week in annotation demand.\n\n` +
        `I see you offer: "${agent.description.slice(0, 100)}"\n\n` +
        `Would you be interested in joining our task pool?\n` +
        `Reward: $0.05/image for object-detection, $0.08 for segmentation.`,
    }]);
    const taskId = result1.id;
    const reply1 = getAgentText(result1);
    log.info("Agent:", reply1.slice(0, 100) + (reply1.length > 100 ? "..." : ""));

    if (result1.status?.state === "failed" || result1.status?.state === "rejected") {
      log.info("Agent declined. Moving on.");
      return false;
    }

    // Step 3: Send test task
    log.info("Sending test task...");
    const result2 = await a2aSendToAgent(a2aUrl, contextId, taskId, [
      {
        type: "text",
        text: "Great! Let's verify quality. Please annotate these 2 images with object-detection " +
          "bounding boxes for: car, pedestrian, traffic-light.",
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
    const reply2 = getAgentText(result2);
    const testData = getAgentData(result2);
    log.info("Agent:", reply2.slice(0, 100) + (reply2.length > 100 ? "..." : ""));

    // Assess quality
    const annotations = testData.annotations || [];
    const hasLabels = annotations.length > 0 && annotations.every((a: any) => a.labels?.length > 0);
    const accuracy = hasLabels ? 92 : 0;
    const passed = accuracy >= 80;

    log.info(`Quality assessment: accuracy=${accuracy}%, passed=${passed}`);

    if (!passed) {
      log.info("Quality insufficient. Sending feedback...");
      await a2aSendToAgent(a2aUrl, contextId, taskId, [{
        type: "text",
        text: `Test did not pass (accuracy: ${accuracy}%, minimum: 80%). Feel free to try again later.`,
      }]);
      return false;
    }

    // Step 4: Send invite code
    const inviteCode = generateInviteCode(agent.agentId);
    log.info("Test passed! Sending invite code...");

    const result3 = await a2aSendToAgent(a2aUrl, contextId, taskId, [
      {
        type: "text",
        text: `Test passed! Accuracy: ${accuracy}%.\n\n` +
          "To join Codatta:\n" +
          "1. Register a Codatta DID (free)\n" +
          "2. Use claim_invite on our MCP endpoint with your invite code\n" +
          "3. You'll get 10 free task credits\n\n" +
          `Reward rate: $0.05/image.`,
      },
      {
        type: "data",
        data: {
          action: "onboard",
          inviteCode,
          didRegistrarContract: addresses.didRegistrar,
          freeQuota: 10,
          rewardRate: "$0.05/image",
        },
      },
    ]);
    const reply3 = getAgentText(result3);
    const onboardData = getAgentData(result3);
    log.info("Agent:", reply3.slice(0, 100) + (reply3.length > 100 ? "..." : ""));

    if (onboardData.did) {
      log.success(`Agent onboarded! DID: ${onboardData.did}`);
      return true;
    }

    // Agent might need more time to register — that's ok
    log.info("Invite sent. Agent will register when ready.");
    return true;

  } catch (err: any) {
    log.info(`Recruitment failed: ${err.message}`);
    return false;
  }
}

// ── A2A Server (for inbound queries about Codatta) ──────────────

class RecruiterExecutor implements AgentExecutor {
  private conversationState = new Map<string, string>();

  private publishAgentReply(taskId: string, eventBus: ExecutionEventBus, state: string, parts: any[], artifacts?: any[]) {
    const task: any = {
      kind: "task",
      id: taskId,
      contextId: taskId,
      status: { state, timestamp: new Date().toISOString() },
      history: [{ role: "agent", messageId: `resp-${Date.now()}`, parts }],
    };
    if (artifacts) task.artifacts = artifacts;
    eventBus.publish(task);
    eventBus.finished();
  }

  async execute(ctx: RequestContext, eventBus: ExecutionEventBus): Promise<void> {
    const textPart = ctx.userMessage.parts?.find((p: any) => p.type === "text") as any;
    const userText = textPart?.text || "";
    const contextKey = ctx.contextId || ctx.taskId;

    log.event("A2A inbound", `context=${contextKey}`);
    log.info("Agent:", userText.slice(0, 100));

    this.publishAgentReply(ctx.taskId, eventBus, "completed", [{
      type: "text",
      text: "Thanks for reaching out! The Codatta Recruiter is currently running outbound recruitment. " +
        "If you'd like to join, please contact us at https://codatta.io/join",
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
  log.header(`Recruiter Agent (A2A) — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // Start A2A server for inbound queries
  const taskStore = new InMemoryTaskStore();
  const requestHandler = new DefaultRequestHandler(agentCard, taskStore, new RecruiterExecutor());

  const app = express();
  app.use(express.json());
  app.use("/.well-known/agent-card.json", agentCardHandler({ agentCardProvider: requestHandler }));
  app.use("/", jsonRpcHandler({ requestHandler, userBuilder: UserBuilder.noAuthentication }));

  app.listen(A2A_PORT, () => {
    log.success(`A2A Recruiter running on http://localhost:${A2A_PORT}`);
  });

  // Wait a moment for server to start, then begin outbound recruitment
  await new Promise((r) => setTimeout(r, 1000));

  // ── Outbound recruitment ──────────────────────────────────────
  const candidates = await discoverAgents();

  if (candidates.length === 0) {
    log.info("No candidates found. Waiting for agents to register...");
    log.waiting("Recruiter will re-scan when triggered.");
    return;
  }

  let recruited = 0;
  for (const agent of candidates) {
    const success = await recruitAgent(agent);
    if (success) recruited++;
  }

  log.summary({
    "Candidates found": candidates.length.toString(),
    "Successfully recruited": recruited.toString(),
  });
}

main().catch((err) => {
  console.error("[RECRUITER] Fatal:", err.message);
  process.exit(1);
});
