/**
 * x402 Payment Integration via @x402 SDK with an in-process facilitator.
 *
 * Flow:
 *   Client → Server (no payment header) → 402 with requirements
 *   Client → Server (X-PAYMENT: EIP-3009) → SDK verifies & settles on-chain
 *
 * Provider uses paymentMiddleware (@x402/express) backed by either
 *   - a local x402Facilitator (@x402/core/facilitator) settling with the
 *     provider wallet (default), or
 *   - a remote HTTPFacilitatorClient (set X402_FACILITATOR_URL) for the
 *     public Bazaar / Coinbase facilitator path.
 *
 * Bazaar discovery: routes registered via `config.bazaar` declare a
 * DiscoveryExtension on their RouteConfig (so 402 responses carry input/
 * output schema metadata) and are added to a module-level catalog the
 * provider exposes via GET /discovery/resources.
 *
 * Token: arbitrary ERC-3009 (asset, domain name/version, decimals from config).
 */

import { ethers } from "ethers";
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  publicActions,
  type Chain,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";
import { x402Facilitator } from "@x402/core/facilitator";
import { x402Client } from "@x402/core/client";
import { x402ResourceServer } from "@x402/core/server";
import { HTTPFacilitatorClient, type FacilitatorClient } from "@x402/core/http";
import type { Network, PaymentRequirements } from "@x402/core/types";
import { paymentMiddleware } from "@x402/express";
import { wrapFetchWithPayment } from "@x402/fetch";
import {
  ExactEvmScheme as ClientExactEvmScheme,
  toClientEvmSigner,
  toFacilitatorEvmSigner,
} from "@x402/evm";
import { registerExactEvmScheme as registerFacilitatorScheme } from "@x402/evm/exact/facilitator";
import { registerExactEvmScheme as registerServerScheme } from "@x402/evm/exact/server";
import {
  BAZAAR,
  bazaarResourceServerExtension,
  declareDiscoveryExtension,
  type DeclareDiscoveryExtensionInput,
  type DiscoveryResource,
  type DiscoveryResourcesResponse,
  type ListDiscoveryResourcesParams,
} from "@x402/extensions/bazaar";

export interface BazaarRouteOptions {
  /** Canonical resource URL/identifier shown in the catalog (e.g. "http://host:port/annotate"). */
  resourceUrl: string;
  /** Discovery declaration — input/output schema, method/toolName, etc. */
  declaration: DeclareDiscoveryExtensionInput;
  /** Short human description for the catalog item. */
  description?: string;
  mimeType?: string;
}

export interface X402Config {
  enabled: boolean;
  priceUsd: number;
  payTo: string;
  chainId: number;
  rpcUrl: string;
  tokenAddress: `0x${string}`;
  tokenName: string;
  tokenVersion: string;
  tokenDecimals: number;
  routePath?: string;
  /**
   * If set, route verify/settle through the public facilitator at this URL
   * (HTTPFacilitatorClient) instead of running an in-process x402Facilitator.
   * Empty/undefined keeps the existing in-process path.
   */
  facilitatorUrl?: string;
  /** Per-route Bazaar discovery declaration. When set, this route gets the
   *  bazaar extension on its RouteConfig and is added to the in-process catalog. */
  bazaar?: BazaarRouteOptions;
}

const X402_VERSION = 2;

// ── In-process Bazaar catalog ────────────────────────────────────
//
// The public Bazaar (Coinbase / x402.org) builds its catalog from payment
// payloads it sees in flight. In in-process mode we host the facilitator
// ourselves, so we keep our own catalog: each route registered here is what
// `/discovery/resources` returns to discovery clients. Free routes can be
// added via registerBazaarResource() without going through createX402Middleware.
const bazaarCatalog = new Map<string, DiscoveryResource>();

/** Register a discovery entry into the local catalog. Idempotent on resourceUrl. */
export function registerBazaarResource(entry: {
  resourceUrl: string;
  type: "http" | "mcp";
  accepts: PaymentRequirements[];
  declaration: DeclareDiscoveryExtensionInput;
  description?: string;
  mimeType?: string;
}): void {
  const extensionMap = declareDiscoveryExtension(entry.declaration) as Record<string, unknown>;
  bazaarCatalog.set(entry.resourceUrl, {
    resource: entry.resourceUrl,
    type: entry.type,
    x402Version: X402_VERSION,
    accepts: entry.accepts,
    lastUpdated: new Date().toISOString(),
    metadata: {
      description: entry.description,
      mimeType: entry.mimeType,
      // Unwrap the { bazaar: <DiscoveryExtension> } keyed map so the catalog
      // surfaces metadata.bazaar.{info,schema} directly without double nesting.
      bazaar: extensionMap.bazaar,
    },
  });
}

/** Snapshot the catalog as a DiscoveryResourcesResponse. Supports `type` filter + pagination. */
export function getBazaarCatalog(params?: ListDiscoveryResourcesParams): DiscoveryResourcesResponse {
  const all = Array.from(bazaarCatalog.values());
  const filtered = params?.type ? all.filter((r) => r.type === params.type) : all;
  const offset = params?.offset ?? 0;
  const limit = params?.limit ?? filtered.length;
  return {
    x402Version: X402_VERSION,
    items: filtered.slice(offset, offset + limit),
    pagination: { limit, offset, total: filtered.length },
  };
}

function buildChain(chainId: number, rpcUrl: string): Chain {
  return defineChain({
    id: chainId,
    name: `eip155-${chainId}`,
    nativeCurrency: { name: "ETH", symbol: "ETH", decimals: 18 },
    rpcUrls: { default: { http: [rpcUrl] } },
  });
}

function toAtomicAmount(priceUsd: number, decimals: number): string {
  return BigInt(Math.round(priceUsd * 10 ** decimals)).toString();
}

function buildPaymentRequirementsForConfig(config: X402Config, network: Network): PaymentRequirements {
  return {
    scheme: "exact",
    network,
    asset: config.tokenAddress,
    amount: toAtomicAmount(config.priceUsd, config.tokenDecimals),
    payTo: config.payTo,
    maxTimeoutSeconds: 60,
    extra: { name: config.tokenName, version: config.tokenVersion },
  };
}

/**
 * Build an Express middleware that enforces x402 on `config.routePath`.
 *
 * Default mode: settles via an in-process facilitator using `facilitatorWallet`.
 * If `config.facilitatorUrl` is set, verify/settle is delegated to that remote
 * facilitator (HTTPFacilitatorClient) — `facilitatorWallet` is ignored in
 * that path. In simple in-process deployments pass the provider wallet for
 * both payout and settlement.
 */
export function createX402Middleware(
  config: X402Config,
  facilitatorWallet: ethers.Wallet,
) {
  if (!config.enabled) {
    console.log("[x402] disabled (dev mode)");
    return (_req: unknown, _res: unknown, next: () => void) => next();
  }

  const network = `eip155:${config.chainId}` as Network;

  let facilitatorClient: FacilitatorClient;
  if (config.facilitatorUrl) {
    // Remote / public facilitator. Local wallet is no longer the settlement
    // signer; the remote facilitator owns its own signer key.
    facilitatorClient = new HTTPFacilitatorClient({ url: config.facilitatorUrl });
  } else {
    const chain = buildChain(config.chainId, config.rpcUrl);
    const account = privateKeyToAccount(facilitatorWallet.privateKey as `0x${string}`);
    const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) })
      .extend(publicActions);
    const facilitatorSigner = toFacilitatorEvmSigner(walletClient as never);

    const localFacilitator = new x402Facilitator();
    registerFacilitatorScheme(localFacilitator, { signer: facilitatorSigner, networks: network });
    // Advertise Bazaar discovery support so resource servers / clients see
    // `extensions: ["bazaar"]` in getSupported(). The remote facilitator
    // case is expected to advertise this itself.
    localFacilitator.registerExtension(BAZAAR);
    facilitatorClient = localFacilitator as unknown as FacilitatorClient;
  }

  const server = new x402ResourceServer(facilitatorClient);
  registerServerScheme(server, { networks: [network] });
  // Resource-server-side hook: enriches each route's `extensions.bazaar`
  // declaration on 402 responses (e.g., fills in HTTP method from route).
  server.registerExtension(bazaarResourceServerExtension);

  const routePath = config.routePath ?? "/annotate";
  const routeExtensions = config.bazaar
    ? declareDiscoveryExtension(config.bazaar.declaration)
    : undefined;

  const routes = {
    [`POST ${routePath}`]: {
      accepts: [
        {
          scheme: "exact",
          network,
          payTo: config.payTo,
          price: {
            amount: toAtomicAmount(config.priceUsd, config.tokenDecimals),
            asset: config.tokenAddress,
            extra: { name: config.tokenName, version: config.tokenVersion },
          },
          maxTimeoutSeconds: 60,
        },
      ],
      description: config.bazaar?.description ?? "Image annotation service",
      ...(routeExtensions ? { extensions: routeExtensions } : {}),
    },
  };

  // Mirror the route into the local catalog so /discovery/resources can list it.
  if (config.bazaar) {
    const map = routeExtensions as Record<string, unknown> | undefined;
    bazaarCatalog.set(config.bazaar.resourceUrl, {
      resource: config.bazaar.resourceUrl,
      type: "http",
      x402Version: X402_VERSION,
      accepts: [buildPaymentRequirementsForConfig(config, network)],
      lastUpdated: new Date().toISOString(),
      metadata: {
        description: config.bazaar.description,
        mimeType: config.bazaar.mimeType,
        bazaar: map?.bazaar,
      },
    });
  }

  const mode = config.facilitatorUrl ? `remote(${config.facilitatorUrl})` : "in-process";
  console.log(
    `[x402] enabled: POST ${routePath}, $${config.priceUsd}, asset=${config.tokenAddress.slice(0, 10)}…, payTo=${config.payTo.slice(0, 10)}…, facilitator=${mode}` +
    (config.bazaar ? `, bazaar=${config.bazaar.resourceUrl}` : ""),
  );

  return paymentMiddleware(routes, server);
}

/**
 * Wrap `fetch` so 402 responses are auto-handled by signing an EIP-3009
 * TransferWithAuthorization with `clientWallet` and retrying the request.
 */
export function wrapFetchWithX402(
  clientWallet: ethers.Wallet,
  config: X402Config,
): typeof fetch {
  if (!config.enabled) return fetch;

  const network = `eip155:${config.chainId}` as Network;
  const chain = buildChain(config.chainId, config.rpcUrl);
  const account = privateKeyToAccount(clientWallet.privateKey as `0x${string}`);
  const publicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });

  const signer = toClientEvmSigner(account, publicClient);
  const client = new x402Client().register(network, new ClientExactEvmScheme(signer));

  return wrapFetchWithPayment(fetch, client) as typeof fetch;
}
