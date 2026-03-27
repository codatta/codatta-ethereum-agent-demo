import { ethers } from "ethers";

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

  const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint256", "address", "uint64", "uint256", "uint256", "address", "address"],
    [agentId, clientAddress, indexLimit, expiry, chainId, identityRegistry, signerWallet.address]
  );

  const messageHash = ethers.keccak256(encoded);
  const signature = await signerWallet.signMessage(ethers.getBytes(messageHash));

  return ethers.concat([encoded, signature]);
}
