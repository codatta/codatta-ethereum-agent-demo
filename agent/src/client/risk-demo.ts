/**
 * Risk-score client demo.
 *
 * Sibling of `start:client` (sync annotate) and `start:client-async`. Finds a
 * provider that advertises `risk-score` in its ERC-8004 registrationFile's
 * `syncServices`, connects over MCP, and exercises `risk_score` on a handful
 * of demo addresses covering the three score buckets (blacklist / proximity /
 * clean) plus an invalid input.
 *
 * Read-only: no wallet, no registration, no payment. risk_score is a pure
 * lookup — this demo skips everything annotate / async need.
 */
import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { provider, addresses, INVITE_SERVICE_URL } from "../shared/config.js";
import { IdentityRegistryABI } from "../shared/abis.js";
import * as log from "../shared/logger.js";

log.setRole("client");

const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);

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

interface DiscoveredProvider {
  agentId: bigint | null; // null in DID-only mode (provider not registered on ERC-8004)
  did: string | null;
  mcpEndpoint: string;
  source: "profile-service" | "erc8004";
}

function profileHasRiskScore(profile: Record<string, unknown>): { mcpEndpoint: string } | null {
  const services = (profile.services || []) as Array<{ name: string; endpoint: string }>;
  const mcp = services.find(s => s.name === "MCP");
  const syncServices = (profile.syncServices || []) as Array<{ name: string; mcpTool?: string }>;
  const hasRiskScore = syncServices.some(s => s.name === "risk-score" && s.mcpTool === "risk_score");
  return mcp && hasRiskScore ? { mcpEndpoint: mcp.endpoint } : null;
}

// Prefer profile-service discovery: it works for DID-only providers (no
// ERC-8004 agentId needed) and honors the "profile is single source of truth"
// architecture. Source of DID: `PROVIDER_DID` env var, or the provider's local
// `agent-info.json` (co-located demo scenario).
async function discoverViaProfileService(): Promise<DiscoveredProvider | null> {
  let did = process.env.PROVIDER_DID?.trim() || null;
  let agentIdStr: string | null = null;
  if (!did) {
    const agentInfoPath = path.join(import.meta.dirname, "../../agent-info.json");
    if (!fs.existsSync(agentInfoPath)) return null;
    try {
      const info = JSON.parse(fs.readFileSync(agentInfoPath, "utf-8")) as { agentId?: string | null; did?: string };
      did = info.did || null;
      agentIdStr = info.agentId || null;
    } catch {
      return null;
    }
  }
  if (!did) return null;
  try {
    const res = await fetch(`${INVITE_SERVICE_URL}/profiles/${did}`);
    if (!res.ok) return null;
    const profile = await res.json() as Record<string, unknown>;
    const hit = profileHasRiskScore(profile);
    if (!hit) return null;
    return { agentId: agentIdStr ? BigInt(agentIdStr) : null, did, mcpEndpoint: hit.mcpEndpoint, source: "profile-service" };
  } catch {
    return null;
  }
}

async function discoverViaERC8004(): Promise<DiscoveredProvider> {
  const events = await identity.queryFilter(identity.filters.Registered());
  for (let i = events.length - 1; i >= 0; i--) {
    const evt = events[i] as any;
    const id = BigInt(evt.args.agentId || evt.args[0]);
    try {
      const uri = await identity.tokenURI(id);
      const reg = await fetchRegistrationFile(uri);
      const hit = profileHasRiskScore(reg);
      if (hit) return { agentId: id, did: null, mcpEndpoint: hit.mcpEndpoint, source: "erc8004" };
    } catch {}
  }
  throw new Error("No provider advertising risk-score found (tried profile-service and ERC-8004).");
}

function parseTextContent(content: unknown): any {
  const arr = Array.isArray(content) ? content : [];
  const first = arr[0] as any;
  if (!first || typeof first.text !== "string") return null;
  try { return JSON.parse(first.text); } catch { return first.text; }
}

const DEMO_CASES: Array<[string, string]> = [
  ["sanctioned",         "0x1111111111111111111111111111111111111111"],
  ["known-scam",         "0x3333333333333333333333333333333333333333"],
  ["proximity (1 hop)",  "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
  ["proximity (2 hops)", "0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb"],
  ["clean",              "0x9999999999999999999999999999999999999999"],
  ["invalid format",     "not-a-valid-address"],
];

async function main() {
  const network = await provider.getNetwork();
  log.header(`Risk-Score Client Demo — Chain ${network.chainId}`);

  log.step("Discovering provider with risk-score in syncServices");
  const prov = (await discoverViaProfileService()) ?? await discoverViaERC8004();
  const agentLabel = prov.agentId !== null ? `agentId=${prov.agentId}` : "(DID-only, no agentId)";
  log.success(`Provider via ${prov.source}: ${agentLabel}, MCP=${prov.mcpEndpoint}`);

  log.step("Connecting MCP");
  const mcp = new Client({ name: "codatta-risk-client", version: "1.0.0" });
  await mcp.connect(new StreamableHTTPClientTransport(new URL(prov.mcpEndpoint)));
  log.success("Connected");

  log.step("Scoring demo addresses");
  for (const [label, address] of DEMO_CASES) {
    try {
      const r = await mcp.callTool({ name: "risk_score", arguments: { address } });
      const firstText = (Array.isArray(r.content) && r.content[0] && typeof (r.content[0] as any).text === "string")
        ? (r.content[0] as any).text as string
        : null;
      // MCP SDK returns input-validation failures as a content-text message
      // prefixed with "MCP error" (and sets isError when the server flags it).
      if (r.isError || (firstText && firstText.startsWith("MCP error"))) {
        log.info(`[${label}] ${address}`);
        log.info(`  rejected: ${firstText ?? "(no detail)"}`);
        continue;
      }
      const result = parseTextContent(r.content);
      if (result && typeof result === "object") {
        log.info(`[${label}] ${address}`);
        log.info(`  score=${result.riskScore}  labels=[${(result.labels || []).join(", ")}]`);
        log.info(`  reasoning: ${result.reasoning}`);
      } else {
        log.info(`[${label}] ${address}  → unexpected response: ${JSON.stringify(r.content)}`);
      }
    } catch (e: any) {
      log.info(`[${label}] ${address}  → ERROR: ${e.message || e}`);
    }
  }

  await mcp.close();
  log.success("Done");
}

main().catch((err) => {
  console.error("[CLIENT] Fatal:", err?.message || err);
  process.exit(1);
});
