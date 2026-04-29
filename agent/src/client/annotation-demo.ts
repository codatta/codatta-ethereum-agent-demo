import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import readline from "readline";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import {
  provider, getWallet, addresses, hexToDidUri,
  X402_ENABLED, USDC_PRICE_PER_IMAGE, USDC_ADDRESS, USDC_NAME, USDC_VERSION, USDC_DECIMALS, RPC_URL,
} from "../shared/config.js";

/**
 * Fetch ERC-8004 registrationFile from a tokenURI.
 * Supports both legacy inline base64 and modern URL pointers.
 */
async function fetchRegistrationFile(uri: string): Promise<Record<string, unknown>> {
  if (uri.startsWith("data:application/json;base64,")) {
    const base64 = uri.replace("data:application/json;base64,", "");
    return JSON.parse(Buffer.from(base64, "base64").toString());
  }
  if (uri.startsWith("http://") || uri.startsWith("https://")) {
    const res = await fetch(uri);
    if (!res.ok) throw new Error(`tokenURI fetch failed: HTTP ${res.status}`);
    return await res.json() as Record<string, unknown>;
  }
  return {};
}
import { wrapFetchWithX402, type X402Config } from "../shared/x402.js";
import {
  IdentityRegistryABI, ReputationRegistryABI, DIDRegistryABI, InviteRegistrarABI,
} from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("client");

const wallet = getWallet("CLIENT_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, provider);
const inviteRegistrar = new ethers.Contract(addresses.inviteRegistrar, InviteRegistrarABI, wallet);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, wallet);

const CLIENT_IDENTITY_FILE = path.join(import.meta.dirname, "../../client-identity.json");

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
    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.trim().toLowerCase());
    });
  });
}

async function discoverProviderId(excludeOwner: string): Promise<bigint> {
  // Discovery is pure on-chain: query IdentityRegistry for 8004 agents whose
  // registrationFile advertises an MCP service endpoint. Providers that haven't
  // registered on ERC-8004 are not discoverable through this path — by design.
  log.info("Querying ERC-8004 IdentityRegistry for providers...");
  const registeredEvents = await identity.queryFilter(
    identity.filters.Registered()
  );

  let totalScanned = 0;
  for (let i = registeredEvents.length - 1; i >= 0; i--) {
    const evt = registeredEvents[i] as any;
    const id = BigInt(evt.args.agentId || evt.args[0]);
    const owner = evt.args.owner || evt.args[2];
    if (owner.toLowerCase() === excludeOwner.toLowerCase()) continue;
    totalScanned++;

    try {
      const uri = await identity.tokenURI(id);
      const regFile = await fetchRegistrationFile(uri);
      const services = (regFile.services || []) as Array<{ name: string }>;
      if (services.some(s => s.name === "MCP")) {
        log.info(`Found provider: agentId=${id} (${registeredEvents.length} total agents on-chain)`);
        return id;
      }
    } catch {
      // tokenURI fetch or parse failed — skip this agent
    }
  }

  throw new Error(
    `No ERC-8004 providers found with MCP service (scanned ${totalScanned} agents). ` +
    `Register a provider on ERC-8004 first.`
  );
}

// ── A2A helpers ─────────────────────────────────────────────────
let rpcId = 1;
const A2A_CONTEXT = `client-ctx-${Date.now()}`;

async function a2aSend(xFetch: (url: string, init?: RequestInit) => Promise<Response>, url: string, taskId: string | undefined, parts: any[]): Promise<any> {
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
  const res = await xFetch(url, {
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

  // x402 payment wrapper — auto-signs EIP-3009 on 402 and retries.
  // payTo/tokenAddress below are placeholders; server's 402 response overrides.
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
  const x402Fetch = wrapFetchWithX402(wallet, x402Config);

  // ── Step 1: Register Client on ERC-8004 ──────────────────────
  log.step("Registering client identity (ERC-8004)");

  let clientAgentId: bigint;
  const saved = loadClientIdentity();

  if (saved?.agentId && saved?.chainId === Number(network.chainId)) {
    clientAgentId = BigInt(saved.agentId);
    try {
      const owner = await identity.ownerOf(clientAgentId);
      if (owner.toLowerCase() === wallet.address.toLowerCase()) {
        log.success(`Client already registered: agentId=${clientAgentId}`);
      } else {
        throw new Error("Owner mismatch");
      }
    } catch {
      log.info("Saved identity invalid, re-registering...");
      saved.agentId = undefined;
    }
  }

  if (!saved?.agentId) {
    const tokenUri = Buffer.from(JSON.stringify({
      name: "Client Agent",
      description: "Data annotation consumer",
      type: "client",
      services: [],
    })).toString("base64");

    log.info("Registering on IdentityRegistry...");
    const tx = await identity.register(`data:application/json;base64,${tokenUri}`);
    const receipt = await tx.wait();

    const regEvent = receipt.logs
      .map((l: ethers.Log) => {
        try { return identity.interface.parseLog({ topics: [...l.topics], data: l.data }); }
        catch { return null; }
      })
      .find((e: ethers.LogDescription | null) => e?.name === "Registered");

    clientAgentId = BigInt(regEvent!.args.agentId);
    saveClientIdentity({ agentId: clientAgentId.toString(), chainId: Number(network.chainId) });
    log.success(`Registered: agentId=${clientAgentId}`);
  }

  // ── Step 2: Discover Provider from ERC-8004 ─────────────────
  log.step("Discovering provider from ERC-8004");

  const agentId = await discoverProviderId(wallet.address);
  log.info("Agent ID:", agentId.toString());

  const agentURI = await identity.tokenURI(agentId);
  const providerAddr = await identity.ownerOf(agentId) as string;

  const registrationFile = await fetchRegistrationFile(agentURI);

  log.info("Agent name:", (registrationFile.name as string) || "unknown");

  const services = (registrationFile.services || []) as Array<{ name: string; endpoint: string }>;
  for (const svc of services) {
    log.info(`  ${svc.name}:`, svc.endpoint);
  }

  const mcpService = services.find(s => s.name === "MCP");
  const a2aService = services.find(s => s.name === "A2A");
  if (!mcpService) throw new Error("No MCP endpoint found");

  // ── Step 3: A2A consultation — learn about services + get invite ─
  log.step("A2A consultation with Provider");

  if (a2aService) {
    const a2aUrl = a2aService.endpoint.replace(/\/\.well-known\/agent-card\.json$/, "");
    const cardUrl = a2aUrl.replace(/\/$/, "") + "/.well-known/agent-card.json";

    // Fetch Agent Card
    const cardRes = await fetch(cardUrl);
    const card = await cardRes.json() as any;
    log.info("A2A Agent:", card.name);
    log.info("Skills:", card.skills?.map((s: any) => s.name).join(", "));

    // Ask about services
    const result1 = await a2aSend(x402Fetch, a2aUrl, undefined, [{
      type: "text",
      text: "Hi, I need image annotation for autonomous driving data. What do you offer?",
    }]);
    const taskId = result1.id;
    log.info("Provider:", getAgentText(result1).slice(0, 120) + "...");

    // Request invite code
    const result2 = await a2aSend(x402Fetch, a2aUrl, taskId, [
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
      const transport = new StreamableHTTPClientTransport(new URL(mcpService.endpoint), { fetch: x402Fetch });
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

      const callResult = await mcpClient.callTool({
        name: "annotate",
        arguments: { images, task: "object-detection", clientAddress: wallet.address, clientDid: inviteData.clientDid },
      });
      const callText = callResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
      const result: any = callText ? JSON.parse(callText.text) : {};
      if (result.status !== "completed") throw new Error(`Unexpected status: ${result.status}`);

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

    if (inviteData.nonce && inviteData.signature) {
      log.success(`Invite received: nonce=${inviteData.nonce}, inviter=${inviteData.inviter?.slice(0, 10)}...`);
      log.info(`InviteRegistrar: ${inviteData.inviteRegistrar}`);

      // ── Step 4: Register Codatta DID (with user confirmation) ────
      log.step("Register Codatta DID?");
      log.info("Benefits: free DID registration with on-chain invite attribution");
      log.info("Cost: Free (on-chain transaction)");

      const answer = await askUser("\n  Register Codatta DID and claim free quota? (y/n): ");

      let clientDid: string | null = null;
      const accepted = answer === "y" || answer === "yes";

      if (accepted) {
        // ── Step 4b: Register DID via InviteRegistrar (on-chain) ──
        log.step("Registering Codatta DID with invite code (on-chain)");
        log.info(`Inviter: ${inviteData.inviter}`);
        log.info(`Nonce: ${inviteData.nonce}`);

        const regTx = await inviteRegistrar.registerWithInvite(
          inviteData.inviter,
          inviteData.nonce,
          inviteData.signature
        );
        const regReceipt = await regTx.wait();

        // Parse InviteRegistered event
        const inviteEvent = regReceipt.logs
          .map((l: ethers.Log) => {
            try { return inviteRegistrar.interface.parseLog({ topics: [...l.topics], data: l.data }); }
            catch { return null; }
          })
          .find((e: ethers.LogDescription | null) => e?.name === "InviteRegistered");

        clientDid = hexToDidUri(inviteEvent!.args.identifier.toString(16));
        log.success(`Registered DID: ${clientDid}`);
        log.info(`Invite attribution recorded on-chain (inviter: ${inviteData.inviter.slice(0, 10)}...)`);
      } else {
        log.info("Declined DID registration. Proceeding without invite.");
      }

      // ── Step 5: Connect MCP and use annotation service ──────────
      log.step(accepted ? "Requesting annotation" : "Requesting annotation (paid mode)");

      const mcpClient = new Client({ name: "codatta-client", version: "1.0.0" });
      const transport = new StreamableHTTPClientTransport(new URL(mcpService.endpoint), { fetch: x402Fetch });
      await mcpClient.connect(transport);

      const { tools } = await mcpClient.listTools();
      log.info(`Discovered ${tools.length} tool(s): ${tools.map(t => t.name).join(", ")}`);

      // ── Step 6: Annotate ──────────────────────────────────────────
      const images = [
        "https://example.com/street-001.jpg",
        "https://example.com/street-002.jpg",
        "https://example.com/street-003.jpg",
      ];

      log.info(`Calling annotate: ${images.length} images, task=object-detection`);

      const callResult = await mcpClient.callTool({
        name: "annotate",
        arguments: {
          images,
          task: "object-detection",
          clientAddress: wallet.address,
        },
      });
      const callText = callResult.content.find((c): c is { type: "text"; text: string } => (c as any).type === "text");
      const result: any = callText ? JSON.parse(callText.text) : {};
      if (result.status !== "completed") throw new Error(`Unexpected status: ${result.status}`);

      log.success(`Annotation received: ${result.annotations.length} images (${result.duration})`);
      for (const ann of result.annotations) {
        log.info(`  ${ann.image}: ${ann.labels.map((l: any) => `${l.class}(${l.confidence})`).join(", ")}`);
      }

      await mcpClient.close();

      // ── Step 7: Submit reputation feedback ──────────────────────
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
        "Invite": accepted ? "On-chain (InviteRegistrar)" : "Skipped",
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
