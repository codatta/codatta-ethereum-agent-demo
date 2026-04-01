import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { provider, getWallet, addresses } from "../shared/config.js";
import {
  IdentityRegistryABI, ReputationRegistryABI,
} from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("client");

const wallet = getWallet("CLIENT_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, wallet);

const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

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
  log.info("Description:", ((registrationFile.description as string) || "").slice(0, 80) + "...");
  log.info("Owner:", providerAddr);

  const services = (registrationFile.services || []) as Array<{ name: string; endpoint: string }>;
  for (const svc of services) {
    log.info(`  ${svc.name}:`, svc.endpoint);
  }

  // Find MCP endpoint
  const mcpService = services.find(s => s.name === "MCP");
  if (!mcpService) throw new Error("No MCP service endpoint found");

  log.success(`MCP endpoint: ${mcpService.endpoint}`);

  // ── Step 2: Connect MCP Client and discover tools ─────────────
  log.step("Connecting to MCP server");

  const mcpClient = new Client({ name: "codatta-client", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL(mcpService.endpoint));
  await mcpClient.connect(transport);

  log.info("MCP connection established");

  // Discover tools
  const { tools } = await mcpClient.listTools();
  log.info(`Discovered ${tools.length} tool(s):`);
  for (const tool of tools) {
    log.info(`  ${tool.name}: ${tool.description}`);
  }

  const annotateTool = tools.find(t => t.name === "annotate");
  if (!annotateTool) throw new Error("annotate tool not found on MCP server");

  // ── Step 3: Call annotation tool via MCP ───────────────────────
  log.step("Requesting annotation via MCP");

  const images = [
    "https://example.com/street-001.jpg",
    "https://example.com/street-002.jpg",
    "https://example.com/street-003.jpg",
  ];

  log.info(`Calling annotate tool: ${images.length} images, task=object-detection`);

  const mcpResult = await mcpClient.callTool({
    name: "annotate",
    arguments: {
      images,
      task: "object-detection",
      clientAddress: wallet.address,
    },
  });

  // Parse result from MCP text content
  const textContent = mcpResult.content.find(
    (c): c is { type: "text"; text: string } => (c as any).type === "text"
  );
  if (!textContent) throw new Error("No text result from MCP tool");

  const result = JSON.parse(textContent.text) as {
    status: string;
    annotations: Array<{ image: string; labels: Array<{ class: string; confidence: number }> }>;
    agentId: string;
    feedbackAuth: string;
  };

  log.success(`Annotation received: ${result.annotations.length} images`);
  for (const ann of result.annotations) {
    log.info(`  ${ann.image}: ${ann.labels.map(l => `${l.class}(${l.confidence})`).join(", ")}`);
  }

  // Close MCP connection
  await mcpClient.close();

  // ── Step 4: Submit reputation feedback ────────────────────────
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
  } else {
    log.info("No feedbackAuth received, skipping feedback");
  }

  // ── Summary ───────────────────────────────────────────────────
  const score = await reputation.getScore(agentId);
  log.summary({
    "Agent ID": agentId.toString(),
    "Reputation Score": score.toString(),
    "Annotations": `${result.annotations.length} images`,
    "Protocol": "MCP (Streamable HTTP)",
    "Status": result.status,
  });

  // Cleanup
  try { fs.unlinkSync(AGENT_INFO_FILE); } catch {}
}

main().catch((err) => {
  console.error("[CLIENT] Fatal:", err.message);
  process.exit(1);
});
