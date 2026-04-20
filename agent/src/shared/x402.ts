/**
 * x402 Payment Integration using real ERC-3009 token transfers.
 *
 * Flow:
 *   Client → Server (no payment header) → 402 with requirements
 *   Client → Server (X-PAYMENT: EIP-3009 TransferWithAuthorization) → verified + settled on-chain
 *
 * Settlement: transferWithAuthorization called on MockERC3009 via ethers.
 *
 * For Anvil: deploy MockERC3009, set USDC_ADDRESS in .env
 */

import { ethers } from "ethers";

// ── Types ──────────────────────────────────────────────────────

export interface X402Config {
  enabled: boolean;
  pricePerImageUsd: number;
  payTo: string;
  chainId: number;
  usdcAddress: string;
  networkName: string;
}

// EIP-3009 TransferWithAuthorization payload
export interface EIP3009Payload {
  authorization: {
    from: string;
    to: string;
    value: string;
    validAfter: string;
    validBefore: string;
    nonce: string;
  };
  signature: string;
}

// ── ERC-3009 constants (must match MockERC3009.sol) ──────────

const MOCK_USDC_NAME = "MockERC3009";
const MOCK_USDC_VERSION = "1";

const EIP3009_ABI = [
  "function transferWithAuthorization(address from, address to, uint256 value, uint256 validAfter, uint256 validBefore, bytes32 nonce, uint8 v, bytes32 r, bytes32 s)",
  "function authorizationState(address authorizer, bytes32 nonce) view returns (bool)",
  "function balanceOf(address account) view returns (uint256)",
];

// ── Signing (EIP-3009 TransferWithAuthorization) ───────────────

export async function signEIP3009Transfer(params: {
  wallet: ethers.Wallet;
  tokenAddress: string;
  chainId: number;
  from: string;
  to: string;
  value: bigint;
  validAfter?: number;
  validBefore?: number;
}): Promise<EIP3009Payload> {
  const { wallet, tokenAddress, chainId, from, to, value, validAfter, validBefore } = params;
  const now = Math.floor(Date.now() / 1000);
  const nonce = ethers.keccak256(
    ethers.concat([ethers.toUtf8Bytes(from), ethers.toUtf8Bytes(`${now}`), ethers.randomBytes(16)])
  ).slice(2);

  const domain = {
    name: MOCK_USDC_NAME,
    version: MOCK_USDC_VERSION,
    chainId,
    verifyingContract: tokenAddress,
  };
  const types = {
    TransferWithAuthorization: [
      { name: "from", type: "address" },
      { name: "to", type: "address" },
      { name: "value", type: "uint256" },
      { name: "validAfter", type: "uint256" },
      { name: "validBefore", type: "uint256" },
      { name: "nonce", type: "bytes32" },
    ],
  };
  const message = {
    from,
    to,
    value,
    validAfter: validAfter ?? now - 600,
    validBefore: validBefore ?? now + 3600,
    nonce: "0x" + nonce,
  };

  const signature = await wallet.signTypedData(domain, types, message);
  const sig = ethers.Signature.from(signature);

  return {
    authorization: {
      from,
      to,
      value: value.toString(),
      validAfter: String(message.validAfter),
      validBefore: String(message.validBefore),
      nonce: message.nonce,
    },
    signature,
  };
}

// ── On-chain verification + settlement ─────────────────────────

async function checkNonce(provider: ethers.JsonRpcProvider, tokenAddress: string, from: string, nonce: string): Promise<boolean> {
  try {
    const token = new ethers.Contract(tokenAddress, ["function authorizationState(address,bytes32) view returns (bool)"], provider);
    return await token.authorizationState(from, nonce) as boolean;
  } catch {
    return false;
  }
}

async function settleOnChain(wallet: ethers.Wallet, tokenAddress: string, payload: EIP3009Payload): Promise<void> {
  const { authorization, signature } = payload;
  const sig = ethers.Signature.from(signature);

  const token = new ethers.Contract(tokenAddress, EIP3009_ABI, wallet);

  const tx = await token.transferWithAuthorization(
    authorization.from,
    authorization.to,
    authorization.value,
    authorization.validAfter,
    authorization.validBefore,
    authorization.nonce,
    sig.v,
    sig.r,
    sig.s
  );
  await tx.wait();
  console.log(`[x402] Settled: ${Number(authorization.value) / 1e6} USDC from ${authorization.from.slice(0, 10)}...`);
}

// ── Server middleware ────────────────────────────────────────────

export function createX402Middleware(config: X402Config) {
  const usedNonces = new Set<string>();

  if (config.enabled) {
    console.log(`[x402] ERC-3009 middleware ready: $${config.pricePerImageUsd}/image, payTo=${config.payTo.slice(0, 10)}...`);
  }

  return async (req: any, res: any, next: any) => {
    if (!config.enabled) { next(); return; }
    if (req.method === "OPTIONS") { next(); return; }

    const paymentHeader = req.headers["x-payment"] as string | undefined;

    if (!paymentHeader) {
      const imageCount = req.body?.images?.length || 1;
      const totalAmount = Math.round(config.pricePerImageUsd * imageCount * 1_000_000);

      res.status(402)
        .header("X-PAYMENT-REQUIRED", "true")
        .json({
          error: "Payment required",
          accepts: [{
            scheme: "exact",
            network: config.networkName,
            asset: config.usdcAddress,
            payTo: config.payTo,
            maxAmountRequired: totalAmount.toString(),
            resource: `POST ${req.path}`,
            description: `Image annotation: ${imageCount} image(s) at $${config.pricePerImageUsd}/image`,
            mimeType: "application/json",
            extra: {
              name: MOCK_USDC_NAME,
              version: MOCK_USDC_VERSION,
              assetTransferMethod: "eip3009",
            },
          }],
          x402Version: 1,
        });
      return;
    }

    // Parse payload
    let payload: EIP3009Payload;
    try {
      payload = JSON.parse(Buffer.from(paymentHeader, "base64").toString());
    } catch {
      res.status(402).json({ error: "Invalid payment header encoding" });
      return;
    }

    const { authorization, signature } = payload;
    const { from, to, value, validAfter, validBefore, nonce } = authorization;
    const now = Math.floor(Date.now() / 1000);

    // 1. Time validation
    if (BigInt(validAfter) > BigInt(now + 5)) {
      res.status(402).json({ error: "Payment not yet valid" });
      return;
    }
    if (BigInt(validBefore) < BigInt(now)) {
      res.status(402).json({ error: "Payment expired" });
      return;
    }

    // 2. Amount validation
    const imageCount = req.body?.images?.length || 1;
    const requiredAmount = Math.round(config.pricePerImageUsd * imageCount * 1_000_000);
    if (BigInt(value) < BigInt(requiredAmount)) {
      res.status(402).json({ error: `Insufficient payment: need ${requiredAmount}, got ${value}` });
      return;
    }

    // 3. Recipient validation
    if (to.toLowerCase() !== config.payTo.toLowerCase()) {
      res.status(402).json({ error: `Wrong recipient` });
      return;
    }

    // 4. Signature verification
    try {
      const domain = {
        name: MOCK_USDC_NAME,
        version: MOCK_USDC_VERSION,
        chainId: config.chainId,
        verifyingContract: config.usdcAddress,
      };
      const types = {
        TransferWithAuthorization: [
          { name: "from", type: "address" },
          { name: "to", type: "address" },
          { name: "value", type: "uint256" },
          { name: "validAfter", type: "uint256" },
          { name: "validBefore", type: "uint256" },
          { name: "nonce", type: "bytes32" },
        ],
      };
      const message = { from, to, value: BigInt(value), validAfter: BigInt(validAfter), validBefore: BigInt(validBefore), nonce };
      const recovered = ethers.verifyTypedData(domain, types, message, signature);
      if (recovered.toLowerCase() !== from.toLowerCase()) {
        res.status(402).json({ error: "Invalid signature" });
        return;
      }
    } catch (err: any) {
      res.status(402).json({ error: `Signature verification failed: ${err.message}` });
      return;
    }

    // 5. Nonce replay prevention (on-chain check)
    const isUsed = await checkNonce(req.app.locals.provider, config.usdcAddress, from, nonce);
    if (isUsed) {
      res.status(402).json({ error: "Nonce already used" });
      return;
    }

    // 6. In-memory replay check (before settlement)
    const nonceKey = `${from}:${nonce}`;
    if (usedNonces.has(nonceKey)) {
      res.status(402).json({ error: "Nonce already used" });
      return;
    }
    usedNonces.add(nonceKey);

    // Attach payment info for route handler
    req.x402Payment = { from, value, to };

    // Settlement: after handler sends response, call transferWithAuthorization
    const originalEnd = res.end;
    const wallet = req.app.locals.wallet as ethers.Wallet;
    res.end = function (...args: any[]) {
      // Call settlement asynchronously (don't block response)
      settleOnChain(wallet, config.usdcAddress, payload).catch((err) =>
        console.error(`[x402] Settlement error: ${err.message}`)
      );
      return originalEnd.apply(this, args);
    };

    next();
  };
}

// ── Client: wrapFetchWithX402 ─────────────────────────────────

export function wrapFetchWithX402(wallet: ethers.Wallet, config: X402Config) {
  return async (url: string | URL, init?: RequestInit): Promise<Response> => {
    const res = await fetch(url, init);

    if (res.status !== 402) return res;

    let requirement: any = null;
    try {
      const body = await res.json();
      requirement = body?.accepts?.[0];
    } catch {
      throw new Error("x402: Failed to parse 402 response");
    }

    if (!requirement) throw new Error("x402: No payment requirements in 402 response");

    const amount = BigInt(requirement.maxAmountRequired);
    const payload = await signEIP3009Transfer({
      wallet,
      tokenAddress: requirement.asset || config.usdcAddress,
      chainId: config.chainId,
      from: wallet.address,
      to: requirement.payTo || config.payTo,
      value: amount,
    });

    const paymentHeader = Buffer.from(JSON.stringify(payload)).toString("base64");

    return fetch(url, {
      ...init,
      headers: {
        ...Object.fromEntries(new Headers(init?.headers).entries()),
        "X-PAYMENT": paymentHeader,
      },
    });
  };
}
