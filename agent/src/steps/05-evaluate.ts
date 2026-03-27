import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { deployer, evaluator, addresses } from "../config.js";
import * as log from "../utils/logger.js";

export async function evaluate(jobId: bigint): Promise<void> {
  log.step(5, "Evaluate & Settle");

  const { acpAsEvaluator, token } = getContracts();

  const providerBefore = await token.balanceOf(deployer.address);
  const evaluatorBefore = await token.balanceOf(evaluator.address);
  const treasuryBefore = await token.balanceOf(addresses.treasury);

  const reason = ethers.keccak256(ethers.toUtf8Bytes("quality-pass"));
  await (await acpAsEvaluator.complete(jobId, reason, "0x")).wait();

  const providerEarned =
    (await token.balanceOf(deployer.address)) - providerBefore;
  const evaluatorEarned =
    (await token.balanceOf(evaluator.address)) - evaluatorBefore;
  const treasuryEarned =
    (await token.balanceOf(addresses.treasury)) - treasuryBefore;

  log.info("Provider earned:", ethers.formatEther(providerEarned) + " XNY");
  log.info("Evaluator earned:", ethers.formatEther(evaluatorEarned) + " XNY");
  log.info("Treasury earned:", ethers.formatEther(treasuryEarned) + " XNY");
  log.success("Job completed, funds distributed");
}
