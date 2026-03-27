import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { deployer, evaluator, addresses } from "../config.js";
import * as log from "../utils/logger.js";

export async function queryResults(
  agentId: bigint,
  jobId: bigint
): Promise<void> {
  log.step(8, "Query On-Chain Results");

  const { identity, reputation, validation, acpRead, token } = getContracts();

  // Identity
  const owner = await identity.ownerOf(agentId);
  const didBytes = await identity.getMetadata(agentId, "codatta:did");
  const codattaDid = didBytes !== "0x"
    ? ethers.AbiCoder.defaultAbiCoder().decode(["uint128"], didBytes)[0]
    : 0n;

  // Reputation
  const score = await reputation.getScore(agentId);

  // Validation
  const requestHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string"],
      [jobId, "ipfs://QmMockDeliverable12345"]
    )
  );
  const valStatus = await validation.getValidationStatus(requestHash);

  // Job status
  const job = await acpRead.getJob(jobId);
  const statusNames = [
    "Open",
    "Funded",
    "Submitted",
    "Completed",
    "Rejected",
    "Expired",
  ];

  // Balances
  const providerBalance = await token.balanceOf(deployer.address);

  log.summary({
    "Agent ID": agentId.toString(),
    "Codatta DID": `0x${codattaDid.toString(16)}`,
    Owner: owner,
    "Reputation Score": score.toString(),
    "Validation Score": valStatus[2].toString(),
    "Job Status": statusNames[Number(job[5])],
    "Provider Balance": ethers.formatEther(providerBalance) + " XNY",
  });
}
