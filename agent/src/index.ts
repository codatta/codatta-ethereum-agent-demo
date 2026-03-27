import { provider } from "./config.js";
import { registerAgent } from "./steps/01-register-agent.js";
import { createJob } from "./steps/02-create-job.js";
import { fundJob } from "./steps/03-fund-job.js";
import { submitWork } from "./steps/04-submit-work.js";
import { evaluate } from "./steps/05-evaluate.js";
import { validation } from "./steps/06-validation.js";
import { reputation } from "./steps/07-reputation.js";
import { queryResults } from "./steps/08-query-results.js";
import * as log from "./utils/logger.js";

async function main() {
  const network = await provider.getNetwork();
  log.header(
    `Codatta Demo Agent — Chain ${network.chainId} (${network.name})`
  );

  // Step 1: Register Agent
  const agentId = await registerAgent();

  // Step 2: Create Job
  const jobId = await createJob();

  // Step 3: Fund Job
  await fundJob(jobId);

  // Step 4: Submit Work
  await submitWork(jobId);

  // Step 5: Evaluate & Settle
  await evaluate(jobId);

  // Step 6: Validation
  await validation(agentId, jobId);

  // Step 7: Reputation
  await reputation(agentId);

  // Step 8: Query Results
  await queryResults(agentId, jobId);

  log.header("Demo Complete");
}

main().catch((err) => {
  console.error("Demo failed:", err);
  process.exit(1);
});
