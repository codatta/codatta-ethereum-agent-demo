import { getContracts } from "../contracts.js";
import * as log from "../utils/logger.js";

// Use acpRead (deployer-connected) since deployer is the provider
export async function submitWork(jobId: bigint): Promise<void> {
  log.step(4, "Submit Work (Agent executes)");

  const { acpRead } = getContracts();

  log.info("Simulating data annotation work...");
  // In a real scenario, the agent would do actual work here

  const deliverable = "ipfs://QmMockDeliverable12345";
  await (await acpRead.submit(jobId, deliverable, "0x")).wait();

  log.info("Deliverable:", deliverable);
  log.success("Work submitted");
}
