import { ethers } from "ethers";

/**
 * Build feedbackAuth bytes for ReputationRegistry.giveFeedback
 *
 * Format: 224 bytes ABI-encoded struct + 65 bytes ECDSA signature = 289 bytes
 *
 * The struct fields:
 *   agentId (uint256), clientAddress (address), indexLimit (uint64),
 *   expiry (uint256), chainId (uint256), identityRegistry (address),
 *   signerAddress (address)
 */
export async function buildFeedbackAuth(params: {
  agentId: bigint;
  clientAddress: string;
  indexLimit: number;
  expiry: number;
  chainId: bigint;
  identityRegistry: string;
  signerWallet: ethers.Wallet;
}): Promise<string> {
  const {
    agentId,
    clientAddress,
    indexLimit,
    expiry,
    chainId,
    identityRegistry,
    signerWallet,
  } = params;

  // ABI-encode the struct (224 bytes)
  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint64", "uint256", "uint256", "address", "address"],
    [
      agentId,
      clientAddress,
      indexLimit,
      expiry,
      chainId,
      identityRegistry,
      signerWallet.address,
    ]
  );

  // Hash and sign with EIP-191 personal sign
  const messageHash = ethers.keccak256(encoded);
  const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

  // Concatenate: encoded struct + signature
  return ethers.concat([encoded, signature]);
}
