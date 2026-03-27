import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { evaluator } from "../config.js";
import * as log from "../utils/logger.js";

export async function validation(
  agentId: bigint,
  jobId: bigint
): Promise<void> {
  log.step(6, "Validation (ERC-8004)");

  const { validationAsOwner, validationAsEvaluator, validation } =
    getContracts();

  // Build request hash from job data
  const requestHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string"],
      [jobId, "ipfs://QmMockDeliverable12345"]
    )
  );

  // Agent owner requests validation
  await (
    await validationAsOwner.validationRequest(
      evaluator.address,
      agentId,
      "ipfs://QmMockValidationRequest",
      requestHash
    )
  ).wait();
  log.info("Validation requested");

  // Evaluator responds
  const responseHash = ethers.keccak256(
    ethers.toUtf8Bytes("validation-evidence")
  );
  await (
    await validationAsEvaluator.validationResponse(
      requestHash,
      85, // score
      "ipfs://QmMockValidationReport",
      responseHash,
      ethers.encodeBytes32String("annotation")
    )
  ).wait();
  log.info("Validation response: score=85");

  // Verify
  const status = await validation.getValidationStatus(requestHash);
  log.success(`Validation recorded on-chain, response=${status[2]}`);
}
