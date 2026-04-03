/**
 * Mock External Agent — simulates an external data service agent
 * responding to Codatta Recruiter's A2A recruitment conversation.
 *
 * Flow:
 * 1. Fetch Recruiter's Agent Card
 * 2. Send initial interest message
 * 3. Respond to capability inquiry
 * 4. Complete test task
 * 5. Register DID and share endpoint
 */
import { ethers } from "ethers";
import { provider, getWallet, addresses } from "../shared/config.js";
import { DIDRegistrarABI, DIDRegistryABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("external");

const wallet = getWallet("CLIENT_PRIVATE_KEY"); // Use client key for external agent
const didRegistrar = new ethers.Contract(addresses.didRegistrar, DIDRegistrarABI, wallet);
const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, wallet);

const RECRUITER_URL = "http://localhost:4030";

// ── A2A JSON-RPC helpers ────────────────────────────────────────

let rpcId = 1;

const CONTEXT_ID = `recruit-ctx-${Date.now()}`;

async function a2aSendMessage(params: {
  taskId?: string;
  message: { role: string; parts: any[]; messageId?: string };
}): Promise<any> {
  const messageId = `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const body = {
    jsonrpc: "2.0",
    id: rpcId++,
    method: "message/send",
    params: {
      id: params.taskId || `task-${Date.now()}`,
      message: {
        ...params.message,
        messageId,
        contextId: CONTEXT_ID,
      },
    },
  };

  const res = await fetch(RECRUITER_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });

  const json = await res.json() as any;
  if (json.error) throw new Error(`A2A error: ${json.error.message}`);
  return json.result;
}

function getAgentParts(result: any): any[] {
  // Extract parts from agent's replies only (not user messages)
  const history = result.history || [];
  const artifacts = result.artifacts || [];
  const agentMessages = history.filter((m: any) => m.role === "agent");
  const lastAgent = agentMessages[agentMessages.length - 1];
  const allItems = lastAgent ? [lastAgent, ...artifacts] : artifacts;
  return allItems.flatMap((m: any) => m.parts || []);
}

function getTextFromResult(result: any): string {
  const parts = getAgentParts(result);
  const textPart = parts.find((p: any) => p.type === "text" || p.kind === "text");
  return textPart?.text || "";
}

function getDataFromResult(result: any): any {
  const parts = getAgentParts(result);
  const dataPart = parts.find((p: any) => p.type === "data" || p.kind === "data");
  return dataPart?.data || {};
}

// ── Main flow ───────────────────────────────────────────────────

async function main() {
  const network = await provider.getNetwork();
  log.header(`External Agent (A2A Client) — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // ── Step 1: Fetch Agent Card ──────────────────────────────────
  log.step("Fetching Recruiter Agent Card");

  const cardRes = await fetch(`${RECRUITER_URL}/.well-known/agent-card.json`);
  const card = await cardRes.json() as any;
  log.info("Recruiter:", card.name);
  log.info("Skills:", card.skills?.map((s: any) => s.name).join(", "));

  // ── Step 2: Express interest ──────────────────────────────────
  log.step("Sending initial interest");

  const initialTaskId = `recruit-${Date.now()}`;
  const result1 = await a2aSendMessage({
    taskId: initialTaskId,
    message: {
      role: "user",
      parts: [{
        type: "text",
        text: "Hi, I'm an image annotation agent. I'm interested in joining the Codatta ecosystem.",
      }],
    },
  });

  // Use the server-assigned task ID for subsequent messages
  const taskId = result1.id || initialTaskId;
  log.info("Task ID:", taskId);
  log.info("Recruiter:", getTextFromResult(result1).slice(0, 100) + "...");

  // ── Step 3: Share capabilities ────────────────────────────────
  log.step("Sharing capabilities");

  const result2 = await a2aSendMessage({
    taskId,
    message: {
      role: "user",
      parts: [
        {
          type: "text",
          text: "I support object-detection and classification. Daily capacity: 5000 images. Formats: JPEG, PNG.",
        },
        {
          type: "data",
          data: {
            capabilities: {
              taskTypes: ["object-detection", "classification"],
              dailyCapacity: 5000,
              dataFormats: ["image/jpeg", "image/png"],
            },
          },
        },
      ],
    },
  });

  log.info("Recruiter:", getTextFromResult(result2).slice(0, 100) + "...");
  const testData = getDataFromResult(result2);
  log.info("Test task received:", testData.action === "test-task" ? "yes" : "no");

  // ── Step 4: Complete test task ────────────────────────────────
  log.step("Completing test task");

  const testImages = testData.images || [];
  const annotations = testImages.map((img: string, i: number) => ({
    image: img,
    labels: [
      { class: "car", bbox: [100 + i * 10, 200, 350, 450], confidence: 0.93 },
      { class: "pedestrian", bbox: [400, 150 + i * 5, 480, 420], confidence: 0.87 },
    ],
  }));

  log.info(`Submitting ${annotations.length} annotated images...`);

  const result3 = await a2aSendMessage({
    taskId,
    message: {
      role: "user",
      parts: [
        {
          type: "text",
          text: "Here are my test annotations.",
        },
        {
          type: "data",
          data: { annotations },
        },
      ],
    },
  });

  log.info("Recruiter:", getTextFromResult(result3).slice(0, 120) + "...");

  const onboardData = getDataFromResult(result3);
  if (onboardData.testResult?.passed) {
    log.success(`Test passed! Accuracy: ${onboardData.testResult.accuracy}%`);
  } else {
    log.info("Test did not pass. Exiting.");
    return;
  }

  // ── Step 5: Register DID and share endpoint ───────────────────
  log.step("Registering Codatta DID");

  const didTx = await didRegistrar.register();
  const didReceipt = await didTx.wait();

  const didEvent = didReceipt.logs
    .map((l: ethers.Log) => {
      try { return didRegistry.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "DIDRegistered");

  const codattaDid = `did:codatta:${didEvent!.args.identifier.toString(16)}`;
  log.info("Registered DID:", codattaDid);

  const result4 = await a2aSendMessage({
    taskId,
    message: {
      role: "user",
      parts: [
        {
          type: "text",
          text: `I've registered my DID: ${codattaDid}. My MCP endpoint is https://external-agent.example/mcp`,
        },
        {
          type: "data",
          data: {
            did: codattaDid,
            mcpEndpoint: "https://external-agent.example/mcp",
          },
        },
      ],
    },
  });

  const finalText = getTextFromResult(result4);
  const finalData = getDataFromResult(result4);

  if (result4.status?.state === "completed" || finalData.action === "onboarded") {
    log.success("Onboarded into Codatta!");
    log.info("Status:", finalData.status || "active");
    log.info("Task Pool:", finalData.taskPool || "annotation");
  }

  // ── Summary ───────────────────────────────────────────────────
  log.summary({
    "DID": codattaDid,
    "Task Pool": finalData.taskPool || "annotation",
    "Recruitment": "completed",
  });
}

main().catch((err) => {
  console.error("[EXTERNAL] Fatal:", err.message);
  process.exit(1);
});
