import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { deployerWallet, client, addresses, provider } from "../config.js";
import { buildFeedbackAuth } from "../utils/feedback-auth.js";
import * as log from "../utils/logger.js";

export async function reputation(agentId: bigint): Promise<void> {
  log.step(7, "Reputation (ERC-8004)");

  const { reputationAsClient, reputation } = getContracts();

  const network = await provider.getNetwork();

  // Build feedbackAuth signed by deployer (agent owner)
  const feedbackAuth = await buildFeedbackAuth({
    agentId,
    clientAddress: client.address,
    indexLimit: 10,
    expiry: Math.floor(Date.now() / 1000) + 3600, // +1 hour
    chainId: network.chainId,
    identityRegistry: addresses.identityRegistry,
    signerWallet: deployerWallet,
  });

  // Client gives feedback
  const feedbackHash = ethers.keccak256(
    ethers.toUtf8Bytes("feedback-evidence")
  );
  await (
    await reputationAsClient.giveFeedback(
      agentId,
      90, // score
      ethers.encodeBytes32String("annotation"),
      ethers.encodeBytes32String("quality"),
      "ipfs://QmMockFeedbackReport",
      feedbackHash,
      feedbackAuth
    )
  ).wait();
  log.info("Feedback submitted: score=90");

  // Verify
  const score = await reputation.getScore(agentId);
  log.success(`Reputation score on-chain: ${score}`);
}
