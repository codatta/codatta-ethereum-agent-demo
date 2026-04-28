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
  PERMIT2_ADDRESS,
  createPermit2ApprovalTx,
  getPermit2AllowanceReadParams,
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

/** How the asset is transferred from payer to payee in the exact scheme. */
export type X402TransferMethod = "eip3009" | "permit2";

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
   * Asset transfer method. "eip3009" (default) uses transferWithAuthorization;
   * "permit2" uses Permit2 + x402ExactPermit2Proxy and works with any ERC-20.
   * Permit2 mode requires the payer to have approved the canonical Permit2
   * contract once per token. The client wrapper handles this transparently.
   */
  transferMethod?: X402TransferMethod;
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

/**
 * Build the `extra` field for a payment requirement based on transfer method.
 *
 * EIP-3009 path needs the EIP-712 domain (name/version) so the client can sign
 * TransferWithAuthorization. Permit2 path signs against the Permit2 contract's
 * own domain instead, so we surface only the asset transfer method discriminator
 * — extra fields here would be ignored (and may confuse stricter facilitators).
 */
function buildExtraForConfig(config: X402Config): Record<string, unknown> {
  if (config.transferMethod === "permit2") {
    return { assetTransferMethod: "permit2" };
  }
  return { name: config.tokenName, version: config.tokenVersion };
}

function buildPaymentRequirementsForConfig(config: X402Config, network: Network): PaymentRequirements {
  return {
    scheme: "exact",
    network,
    asset: config.tokenAddress,
    amount: toAtomicAmount(config.priceUsd, config.tokenDecimals),
    payTo: config.payTo,
    maxTimeoutSeconds: 60,
    extra: buildExtraForConfig(config),
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
            extra: buildExtraForConfig(config),
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
  const transferMethod = config.transferMethod ?? "eip3009";
  console.log(
    `[x402] enabled: POST ${routePath}, $${config.priceUsd}, asset=${config.tokenAddress.slice(0, 10)}…, payTo=${config.payTo.slice(0, 10)}…, transfer=${transferMethod}, facilitator=${mode}` +
    (config.bazaar ? `, bazaar=${config.bazaar.resourceUrl}` : ""),
  );

  return paymentMiddleware(routes, server);
}

/**
 * Wrap `fetch` so 402 responses are auto-handled by signing the appropriate
 * exact-scheme payload (EIP-3009 or Permit2) with `clientWallet` and retrying.
 *
 * For `transferMethod === "permit2"`, additionally:
 *   - Before the first request, check the payer's Permit2 allowance for the
 *     token. If it's below `priceUsd`, send a one-time `approve(PERMIT2, max)`
 *     transaction via `clientWallet` and wait for the receipt.
 *   - If the second request still returns HTTP 412 (`permit2_allowance_required`,
 *     e.g. due to a race or stale allowance read), re-run approval and retry once.
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
  const innerFetch = wrapFetchWithPayment(fetch, client) as typeof fetch;

  if ((config.transferMethod ?? "eip3009") !== "permit2") {
    return innerFetch;
  }

  const ownerAddress = account.address;
  const requiredAmount = BigInt(toAtomicAmount(config.priceUsd, config.tokenDecimals));
  const ensureApproved = () => ensurePermit2Approved({
    clientWallet,
    publicClient,
    tokenAddress: config.tokenAddress,
    ownerAddress,
    requiredAmount,
  });

  return (async (input, init) => {
    await ensureApproved();
    const res = await innerFetch(input as Parameters<typeof fetch>[0], init);
    if (res.status !== 412) return res;
    // The facilitator declined with `permit2_allowance_required` even though
    // we believed allowance was sufficient — pre-check raced or token reverted
    // the approval. Re-approve and try once more.
    console.log("[x402] 412 permit2_allowance_required → re-approving and retrying");
    await ensureApproved();
    return innerFetch(input as Parameters<typeof fetch>[0], init);
  }) as typeof fetch;
}

interface EnsurePermit2ApprovedOptions {
  clientWallet: ethers.Wallet;
  publicClient: ReturnType<typeof createPublicClient>;
  tokenAddress: `0x${string}`;
  ownerAddress: `0x${string}`;
  requiredAmount: bigint;
}

/**
 * Idempotent: read Permit2 allowance and send `approve(PERMIT2, max)` if it's
 * insufficient. Waits for the receipt before returning so the facilitator
 * sees the new allowance on its next read.
 */
async function ensurePermit2Approved(opts: EnsurePermit2ApprovedOptions): Promise<void> {
  const readParams = getPermit2AllowanceReadParams({
    tokenAddress: opts.tokenAddress,
    ownerAddress: opts.ownerAddress,
  });
  const allowance = (await opts.publicClient.readContract(readParams)) as bigint;
  if (allowance >= opts.requiredAmount) return;

  console.log(
    `[x402] Permit2 allowance ${allowance} < required ${opts.requiredAmount}; sending approve(PERMIT2, max)…`,
  );
  const tx = createPermit2ApprovalTx(opts.tokenAddress);
  const sent = await opts.clientWallet.sendTransaction({
    to: tx.to,
    data: tx.data,
  });
  const receipt = await sent.wait();
  if (!receipt || receipt.status !== 1) {
    throw new Error(`Permit2 approval tx failed: ${sent.hash}`);
  }
  console.log(`[x402] Permit2 approval confirmed in tx ${sent.hash}`);
  // Best-effort sanity read so a downstream race surfaces here, not at 412.
  const after = (await opts.publicClient.readContract(readParams)) as bigint;
  if (after < opts.requiredAmount) {
    throw new Error(
      `Permit2 approval did not raise allowance (still ${after}); check token's approve semantics`,
    );
  }
}

// Re-export the canonical Permit2 address so callers can reference it without
// pulling in @x402/evm directly.
export { PERMIT2_ADDRESS };
