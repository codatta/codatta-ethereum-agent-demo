/**
 * x402 Payment Integration via @x402 SDK with an in-process facilitator.
 *
 * Flow:
 *   Client → Server (no payment header) → 402 with requirements
 *   Client → Server (X-PAYMENT: EIP-3009) → SDK verifies & settles on-chain
 *
 * Provider uses paymentMiddleware (@x402/express) backed by a local
 * x402Facilitator (@x402/core/facilitator) that settles with the provider wallet.
 *
 * Client uses wrapFetchWithPayment (@x402/fetch): returned fetch auto-handles
 * 402 → sign EIP-3009 → retry.
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
import type { FacilitatorClient } from "@x402/core/http";
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
 * Build an Express middleware that enforces x402 on `config.routePath`.
 * Settles via an in-process facilitator using `facilitatorWallet`.
 * In simple deployments pass the provider wallet for both payout and settlement.
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
  const chain = buildChain(config.chainId, config.rpcUrl);
  const account = privateKeyToAccount(facilitatorWallet.privateKey as `0x${string}`);

  // Facilitator needs a viem client that can both read and write (verify + settle).
  const walletClient = createWalletClient({ account, chain, transport: http(config.rpcUrl) })
    .extend(publicActions);
  const facilitatorSigner = toFacilitatorEvmSigner(walletClient as never);

  const facilitator = new x402Facilitator();
  registerFacilitatorScheme(facilitator, { signer: facilitatorSigner, networks: network });

  const server = new x402ResourceServer(facilitator as unknown as FacilitatorClient);
  registerServerScheme(server, { networks: [network] });

  const routePath = config.routePath ?? "/annotate";
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
      description: "Image annotation service",
    },
  };

  console.log(
    `[x402] enabled: POST ${routePath}, $${config.priceUsd}, asset=${config.tokenAddress.slice(0, 10)}…, payTo=${config.payTo.slice(0, 10)}…`,
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
