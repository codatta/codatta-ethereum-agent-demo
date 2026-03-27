import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { deployer, evaluator, addresses } from "../config.js";
import * as log from "../utils/logger.js";

export async function createJob(): Promise<bigint> {
  log.step(2, "Create Job (ERC-8183)");

  const { acpAsClient } = getContracts();

  const expiredAt = Math.floor(Date.now() / 1000) + 86400; // +1 day

  const tx = await acpAsClient.createJob(
    deployer.address,    // provider = agent owner
    evaluator.address,   // evaluator
    expiredAt,
    "Annotate 100 images for object detection",
    addresses.hookContract
  );
  const receipt = await tx.wait();

  const event = receipt.logs
    .map((l: ethers.Log) => {
      try {
        return acpAsClient.interface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        return null;
      }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "JobCreated");

  const jobId: bigint = event!.args.jobId;
  log.info("Job ID:", jobId.toString());
  log.info("Description:", "Annotate 100 images for object detection");
  log.info("Provider:", deployer.address);
  log.info("Evaluator:", evaluator.address);
  log.success("Job created");

  return jobId;
}
