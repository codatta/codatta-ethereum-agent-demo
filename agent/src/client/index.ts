import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { provider, getWallet, addresses } from "../shared/config.js";
import {
  IdentityRegistryABI, ReputationRegistryABI, DIDRegistryABI, DIDRegistrarABI,
} from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("client");

const wallet = getWallet("CLIENT_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);
const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, provider);
const didRegistrar = new ethers.Contract(addresses.didRegistrar, DIDRegistrarABI, wallet);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, wallet);

const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

function askUser(question: string): Promise<string> {
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function discoverAgentId(): Promise<bigint> {
  log.info("Querying marketplace for agents... (reading agent-info.json)");
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(AGENT_INFO_FILE)) {
      try {
        const info = JSON.parse(fs.readFileSync(AGENT_INFO_FILE, "utf-8"));
        return BigInt(info.agentId);
      } catch { /* not ready */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Agent not found — is the Provider running?");
}

// ── A2A helpers ─────────────────────────────────────────────────
let rpcId = 1;
const A2A_CONTEXT = `client-ctx-${Date.now()}`;

async function a2aSend(url: string, taskId: string | undefined, parts: any[]): Promise<any> {
  const body = {
    jsonrpc: "2.0",
    id: rpcId++,
    method: "message/send",
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
  if (!last) return "";
  const text = last.parts?.find((p: any) => p.type === "text" || p.kind === "text");
  return text?.text || "";
}

function getAgentData(result: any): any {
  const history = result.history || [];
  const agent = history.filter((m: any) => m.role === "agent");
  const last = agent[agent.length - 1];
  if (!last) return {};
  const data = last.parts?.find((p: any) => p.type === "data" || p.kind === "data");
  return data?.data || {};
}

async function main() {
  const network = await provider.getNetwork();
  log.header(`Client Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // ── Step 1: Discover Agent from ERC-8004 ──────────────────────
  log.step("Discovering agent from ERC-8004");

  const agentId = await discoverAgentId();
  log.info("Agent ID:", agentId.toString());

  const agentURI = await identity.tokenURI(agentId);
  const providerAddr = await identity.ownerOf(agentId) as string;

  let registrationFile: Record<string, unknown> = {};
  if (agentURI.startsWith("data:application/json;base64,")) {
    const base64 = agentURI.replace("data:application/json;base64,", "");
    registrationFile = JSON.parse(Buffer.from(base64, "base64").toString());
  }

  log.info("Agent name:", (registrationFile.name as string) || "unknown");

  const services = (registrationFile.services || []) as Array<{ name: string; endpoint: string }>;
  for (const svc of services) {
    log.info(`  ${svc.name}:`, svc.endpoint);
  }

  const mcpService = services.find(s => s.name === "MCP");
  const a2aService = services.find(s => s.name === "A2A");
  if (!mcpService) throw new Error("No MCP endpoint found");

  // ── Step 2: A2A consultation — learn about services + get invite ─
  log.step("A2A consultation with Provider");

  if (a2aService) {
    const a2aUrl = a2aService.endpoint.replace("/.well-known/agent-card.json", "");

    // Fetch Agent Card
    const cardRes = await fetch(a2aService.endpoint);
    const card = await cardRes.json() as any;
    log.info("A2A Agent:", card.name);
    log.info("Skills:", card.skills?.map((s: any) => s.name).join(", "));

    // Ask about services
    const result1 = await a2aSend(a2aUrl, undefined, [{
      type: "text",
      text: "Hi, I need image annotation for autonomous driving data. What do you offer?",
    }]);
    const taskId = result1.id;
    log.info("Provider:", getAgentText(result1).slice(0, 120) + "...");

    // Request invite code
    const result2 = await a2aSend(a2aUrl, taskId, [
      { type: "text", text: "Yes, I'd like an invite code for free annotations." },
      { type: "data", data: { clientAddress: wallet.address } },
    ]);
    log.info("Provider:", getAgentText(result2).slice(0, 120) + "...");

    const inviteData = getAgentData(result2);

    // ── Check if returning user ───────────────────────────────────
    if (inviteData.action === "returning-user") {
      log.success(`Welcome back! Already registered: ${inviteData.clientDid}`);
      log.info(`Free quota remaining: ${inviteData.remainingQuota} images`);

      // Go straight to MCP annotate
      const mcpClient = new Client({ name: "codatta-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(mcpService.endpoint));
      await mcpClient.connect(transport);

      const { tools } = await mcpClient.listTools();
      log.info(`Discovered ${tools.length} tool(s): ${tools.map(t => t.name).join(", ")}`);

      log.step("Requesting annotation (returning user)");
      const images = [
        "https://example.com/street-001.jpg",
        "https://example.com/street-002.jpg",
        "https://example.com/street-003.jpg",
      ];
      log.info(`Calling annotate: ${images.length} images, task=object-detection`);

      const submitResult = await mcpClient.callTool({
        name: "annotate",
        arguments: { images, task: "object-detection", clientAddress: wallet.address, clientDid: inviteData.clientDid },
      });
      const submitText = submitResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
      const submitData = submitText ? JSON.parse(submitText.text) : {};
      log.info(`Task submitted: ${submitData.taskId} (status: ${submitData.status})`);

      log.info("Polling for completion...");
      let result: any = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusResult = await mcpClient.callTool({ name: "get_task_status", arguments: { taskId: submitData.taskId } });
        const statusText = statusResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
        if (!statusText) continue;
        const statusData = JSON.parse(statusText.text);
        if (statusData.status === "completed") { result = statusData; break; }
        if (statusData.status === "failed") throw new Error("Annotation task failed");
      }
      if (!result) throw new Error("Task did not complete within timeout");

      log.success(`Annotation received: ${result.annotations.length} images (${result.duration})`);
      for (const ann of result.annotations) {
        log.info(`  ${ann.image}: ${ann.labels.map((l: any) => `${l.class}(${l.confidence})`).join(", ")}`);
      }
      await mcpClient.close();

      const score = await reputation.getScore(agentId);
      log.summary({
        "Agent ID": agentId.toString(),
        "Client DID": inviteData.clientDid,
        "Free Quota Remaining": `${inviteData.remainingQuota - images.length} images`,
        "Reputation Score": score.toString(),
        "Annotations": `${result.annotations.length} images`,
        "Status": "Returning user",
      });
      return;
    }

    if (inviteData.inviteCode) {
      log.success(`Invite code received: ${inviteData.inviteCode.slice(0, 18)}...`);
      log.info(`Free quota: ${inviteData.freeQuota} images`);

      // ── Step 3: Register Codatta DID (with user confirmation) ────
      log.step("Register Codatta DID?");
      log.info(`Benefits: ${inviteData.freeQuota} free annotation credits`);
      log.info("Cost: Free (on-chain transaction)");

      const answer = await askUser("\n  Register Codatta DID and claim free quota? (y/n): ");

      let clientDid: string | null = null;
      const accepted = answer === "y" || answer === "yes";

      if (accepted) {
        // ── Step 3b: Register DID + Claim invite ──────────────────
        log.step("Registering Codatta DID");

        const didTx = await didRegistrar.register();
        const didReceipt = await didTx.wait();
        const didEvent = didReceipt.logs
          .map((l: ethers.Log) => {
            try { return didRegistry.interface.parseLog({ topics: [...l.topics], data: l.data }); }
            catch { return null; }
          })
          .find((e: ethers.LogDescription | null) => e?.name === "DIDRegistered");

        clientDid = `did:codatta:${didEvent!.args.identifier.toString(16)}`;
        log.success(`Registered DID: ${clientDid}`);
      } else {
        log.info("Declined DID registration. Proceeding without free quota.");
      }

      // ── Step 4: Connect MCP and use annotation service ──────────
      log.step(accepted ? "Claiming invite + requesting annotation" : "Requesting annotation (paid mode)");

      const mcpClient = new Client({ name: "codatta-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(mcpService.endpoint));
      await mcpClient.connect(transport);

      const { tools } = await mcpClient.listTools();
      log.info(`Discovered ${tools.length} tool(s): ${tools.map(t => t.name).join(", ")}`);

      // Claim invite if registered
      if (accepted && clientDid) {
        const claimResult = await mcpClient.callTool({
          name: "claim_invite",
          arguments: { inviteCode: inviteData.inviteCode, clientDid },
        });
        const claimText = claimResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
        const claimData = claimText ? JSON.parse(claimText.text) : {};
        log.success(`Invite claimed! Free quota: ${claimData.freeQuota} images`);
      }

      // ── Step 5: Annotate ──────────────────────────────────────────
      const images = [
        "https://example.com/street-001.jpg",
        "https://example.com/street-002.jpg",
        "https://example.com/street-003.jpg",
      ];

      log.info(`Calling annotate: ${images.length} images, task=object-detection`);
      if (accepted) {
        log.info("(using free quota)");
      } else {
        log.info("(no free quota — x402 payment would be required in production)");
      }

      const submitResult = await mcpClient.callTool({
        name: "annotate",
        arguments: {
          images,
          task: "object-detection",
          clientAddress: wallet.address,
          ...(clientDid ? { clientDid } : {}),
        },
      });
      const submitText = submitResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
      const submitData = submitText ? JSON.parse(submitText.text) : {};
      log.info(`Task submitted: ${submitData.taskId} (status: ${submitData.status})`);

      // Poll for completion
      log.info("Polling for completion...");
      let result: any = null;
      for (let i = 0; i < 30; i++) {
        await new Promise((r) => setTimeout(r, 1000));
        const statusResult = await mcpClient.callTool({
          name: "get_task_status",
          arguments: { taskId: submitData.taskId },
        });
        const statusText = statusResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
        if (!statusText) continue;
        const statusData = JSON.parse(statusText.text);
        if (statusData.status === "completed") { result = statusData; break; }
        if (statusData.status === "failed") throw new Error("Annotation task failed");
      }

      if (!result) throw new Error("Task did not complete within timeout");

      log.success(`Annotation received: ${result.annotations.length} images (${result.duration})`);
      for (const ann of result.annotations) {
        log.info(`  ${ann.image}: ${ann.labels.map((l: any) => `${l.class}(${l.confidence})`).join(", ")}`);
      }

      await mcpClient.close();

      // ── Step 6: Submit reputation feedback ──────────────────────
      log.step("Submitting reputation feedback");

      if (result.feedbackAuth) {
        const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes("annotation-feedback"));
        await (await reputation.giveFeedback(
          agentId, 92,
          ethers.encodeBytes32String("annotation"),
          ethers.encodeBytes32String("quality"),
          "ipfs://QmAnnotationFeedback",
          feedbackHash,
          result.feedbackAuth
        )).wait();
        log.success("Feedback submitted: score=92");
      }

      // ── Summary ─────────────────────────────────────────────────
      const score = await reputation.getScore(agentId);
      log.summary({
        "Agent ID": agentId.toString(),
        "Client DID": clientDid || "Not registered",
        "Payment": accepted ? `Free quota (${images.length} images)` : "Paid (x402)",
        "Reputation Score": score.toString(),
        "Annotations": `${result.annotations.length} images`,
        "Protocol": "A2A (consult) → MCP (execute)",
      });

    } else {
      log.info("No invite code received, proceeding without free quota");
    }
  } else {
    log.info("No A2A endpoint found, skipping consultation");
  }
}

main().catch((err) => {
  console.error("[CLIENT] Fatal:", err.message);
  process.exit(1);
});
