/**
 * Self-contained smoke test for x402 Bazaar discovery wiring.
 *
 * Spins up a tiny express app that:
 *   1. Registers an annotate route via createX402Middleware (paid, http body)
 *   2. Registers two MCP entries via registerBazaarResource
 *   3. Exposes GET /discovery/resources backed by getBazaarCatalog
 *
 * Then curls the endpoint, asserts:
 *   - 3 catalog entries
 *   - Each carries metadata.bazaar with input/output schema
 *   - `type=mcp` filter narrows to 2 entries
 *
 * No anvil / on-chain settlement needed — this exercises only the catalog
 * surface. The wider x402 e2e (test-x402-e2e.ts) covers actual settlement.
 */
import { ethers } from "ethers";
import express from "express";
import {
  createX402Middleware,
  registerBazaarResource,
  getBazaarCatalog,
  type X402Config,
} from "./src/shared/x402.js";

const PORT = 4097;
const TOKEN = "0x8A791620dd6260079BF849Dc5567aDC3F2FdC318" as `0x${string}`;
const PROVIDER_ADDR = "0x90F79bf6EB2c4f870365E785982E1f101E93b906";

async function main() {
  const wallet = new ethers.Wallet(
    "0x5de4111afa1a4b94908f83103eb1f1706367c2e68ca870fc3fb9a804cdab365a",
  );
  const httpAnnotateUrl = `http://localhost:${PORT}/annotate`;
  const mcpEndpointUrl = `http://localhost:${PORT}/mcp`;

  const config: X402Config = {
    enabled: true,
    priceUsd: 0.05,
    payTo: PROVIDER_ADDR,
    chainId: 31337,
    rpcUrl: "http://127.0.0.1:8545",
    tokenAddress: TOKEN,
    tokenName: "MockERC3009",
    tokenVersion: "1",
    tokenDecimals: 6,
    routePath: "/annotate",
    bazaar: {
      resourceUrl: httpAnnotateUrl,
      description: "Image annotation over HTTP POST.",
      mimeType: "application/json",
      declaration: {
        method: "POST",
        bodyType: "json",
        input: { images: ["https://example.com/x.jpg"], task: "object-detection" },
        inputSchema: {
          type: "object",
          properties: {
            images: { type: "array", items: { type: "string" } },
            task: { type: "string" },
          },
          required: ["images", "task"],
        },
        output: { example: { status: "completed", annotations: [] } },
      },
    },
  };

  const app = express();
  app.use(express.json());
  app.use(createX402Middleware(config, wallet));
  app.post("/annotate", (_req, res) => res.json({ ok: true }));

  registerBazaarResource({
    resourceUrl: `${mcpEndpointUrl}#annotate`,
    type: "mcp",
    description: "MCP annotate tool",
    accepts: [],
    declaration: {
      toolName: "annotate",
      description: "Label images sync.",
      inputSchema: {
        type: "object",
        properties: { images: { type: "array" }, task: { type: "string" } },
        required: ["images", "task"],
      },
    },
  });

  registerBazaarResource({
    resourceUrl: `${mcpEndpointUrl}#risk_score`,
    type: "mcp",
    description: "MCP risk_score tool",
    accepts: [],
    declaration: {
      toolName: "risk_score",
      description: "Score address risk.",
      inputSchema: {
        type: "object",
        properties: { address: { type: "string" } },
        required: ["address"],
      },
    },
  });

  app.get("/discovery/resources", (req, res) => {
    res.json(getBazaarCatalog({
      type: typeof req.query.type === "string" ? req.query.type : undefined,
    }));
  });

  const server = app.listen(PORT);
  await new Promise((r) => setTimeout(r, 300));

  // 1. List all
  const allRes = await fetch(`http://127.0.0.1:${PORT}/discovery/resources`);
  const all = (await allRes.json()) as {
    x402Version: number;
    items: Array<{ resource: string; type: string; accepts: unknown[]; metadata?: { bazaar?: unknown } }>;
    pagination: { total: number };
  };

  console.log("[test] full catalog:", JSON.stringify(all, null, 2));

  // 2. Filter by type=mcp
  const mcpRes = await fetch(`http://127.0.0.1:${PORT}/discovery/resources?type=mcp`);
  const mcp = (await mcpRes.json()) as { items: Array<{ resource: string }> };

  // 3. POST /annotate without X-PAYMENT → 402 carrying bazaar extension info
  //    (x402 v2 puts the PaymentRequired payload in the X-Payment-Required
  //    header, base64-encoded; v1 puts it in the body.)
  const unpaid = await fetch(`http://127.0.0.1:${PORT}/annotate`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ images: ["https://example.com/x.jpg"], task: "object-detection" }),
  });
  console.log("[test] 402 status:", unpaid.status);
  console.log("[test] 402 headers:", Object.fromEntries(unpaid.headers.entries()));
  const bodyText = await unpaid.text();
  console.log("[test] 402 body raw:", bodyText);
  let unpaidPayload: { extensions?: Record<string, unknown>; accepts?: unknown[] } | null = null;
  const headerCandidates = ["x-payment-required", "x-payment", "payment-required"];
  for (const h of headerCandidates) {
    const v = unpaid.headers.get(h);
    if (v) {
      try { unpaidPayload = JSON.parse(Buffer.from(v, "base64").toString()); break; } catch { /* try next */ }
    }
  }
  if (!unpaidPayload) {
    try { unpaidPayload = JSON.parse(bodyText); } catch { /* ignore */ }
  }
  console.log("[test] 402 parsed payload:", JSON.stringify(unpaidPayload, null, 2));

  // Assertions
  const assertions: Array<[string, boolean]> = [
    ["x402Version is 2", all.x402Version === 2],
    ["3 total items in catalog", all.pagination.total === 3],
    ["http annotate present", all.items.some((i) => i.resource === httpAnnotateUrl && i.type === "http")],
    [
      "mcp annotate present",
      all.items.some((i) => i.resource === `${mcpEndpointUrl}#annotate` && i.type === "mcp"),
    ],
    [
      "mcp risk_score present",
      all.items.some((i) => i.resource === `${mcpEndpointUrl}#risk_score` && i.type === "mcp"),
    ],
    [
      "every item has metadata.bazaar with at least one extension key",
      all.items.every((i) => {
        const bz = i.metadata?.bazaar as Record<string, unknown> | undefined;
        return !!bz && Object.keys(bz).length > 0;
      }),
    ],
    [
      "http annotate carries one PaymentRequirement",
      (() => {
        const it = all.items.find((i) => i.resource === httpAnnotateUrl);
        return !!it && Array.isArray(it.accepts) && it.accepts.length === 1;
      })(),
    ],
    ["risk_score is free (accepts: [])", (() => {
      const it = all.items.find((i) => i.resource === `${mcpEndpointUrl}#risk_score`);
      return !!it && Array.isArray(it.accepts) && it.accepts.length === 0;
    })()],
    ["type=mcp filter returns 2", mcp.items.length === 2],
    ["unpaid /annotate returns 402", unpaid.status === 402],
    [
      "402 payload carries bazaar extension (info + schema)",
      (() => {
        const ext = unpaidPayload?.extensions?.bazaar as { info?: unknown; schema?: unknown } | undefined;
        return !!ext && !!ext.info && !!ext.schema;
      })(),
    ],
  ];

  let allPass = true;
  for (const [name, ok] of assertions) {
    console.log(ok ? `  ✅ ${name}` : `  ❌ ${name}`);
    if (!ok) allPass = false;
  }

  server.close();
  console.log(allPass ? "\n✅ PASS" : "\n❌ FAIL");
  process.exit(allPass ? 0 : 1);
}

main().catch((err) => {
  console.error("[test] error:", err);
  process.exit(1);
});
