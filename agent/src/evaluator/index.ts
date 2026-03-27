import { ethers } from "ethers";
import { provider, getWallet, addresses } from "../shared/config.js";
import { ACPContractABI, ValidationRegistryABI, MockERC20ABI } from "../shared/abis.js";
import { waitForEvent } from "../shared/events.js";
import * as log from "../shared/logger.js";

log.setRole("evaluator");

const wallet = getWallet("EVALUATOR_PRIVATE_KEY");
const acp = new ethers.Contract(addresses.acpContract, ACPContractABI, wallet);
const validation = new ethers.Contract(addresses.validationRegistry, ValidationRegistryABI, wallet);
const token = new ethers.Contract(addresses.tokenContract, MockERC20ABI, provider);

async function main() {
  const network = await provider.getNetwork();
  log.header(`Evaluator Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);
  log.waiting("Listening for job submissions...");

  // Listen for JobSubmitted
  while (true) {
    const args = await waitForEvent(acp, "JobSubmitted");
    const jobId = args[0] as bigint;
    const deliverable = args[1] as string;

    log.event("JobSubmitted", `jobId=${jobId}`);
    log.info("Deliverable:", deliverable);

    // Verify we are the evaluator for this job
    const job = await acp.getJob(jobId);
    if (job[2].toLowerCase() !== wallet.address.toLowerCase()) {
      log.info("Not our job, skipping");
      continue;
    }

    // Simulate evaluation
    log.info("Inspecting deliverable...");
    await new Promise((r) => setTimeout(r, 1500));

    // Record balances before
    const providerBefore = await token.balanceOf(job[1]); // provider
    const evalBefore = await token.balanceOf(wallet.address);
    const treasuryBefore = await token.balanceOf(addresses.treasury);

    // Complete the job
    log.step("Completing job");
    const reason = ethers.keccak256(ethers.toUtf8Bytes("quality-pass"));
    await (await acp.complete(jobId, reason, "0x")).wait();

    const providerEarned = (await token.balanceOf(job[1])) - providerBefore;
    const evalEarned = (await token.balanceOf(wallet.address)) - evalBefore;
    const treasuryEarned = (await token.balanceOf(addresses.treasury)) - treasuryBefore;

    log.info("Provider earned:", ethers.formatEther(providerEarned) + " XNY");
    log.info("Evaluator earned:", ethers.formatEther(evalEarned) + " XNY");
    log.info("Treasury earned:", ethers.formatEther(treasuryEarned) + " XNY");
    log.success("Job completed and funds distributed");

    // Listen for ValidationRequest
    log.waiting("Listening for validation request...");
    const valArgs = await waitForEvent(
      validation,
      "ValidationRequest",
      (validatorAddr: unknown) =>
        (validatorAddr as string).toLowerCase() === wallet.address.toLowerCase()
    );

    const requestHash = valArgs[3] as string;
    const agentId = valArgs[1] as bigint;
    log.event("ValidationRequest", `agentId=${agentId}`);

    // Submit validation response
    log.step("Submitting validation response");
    const responseHash = ethers.keccak256(ethers.toUtf8Bytes("validation-evidence"));
    await (
      await validation.validationResponse(
        requestHash,
        85,
        "ipfs://QmMockValidationReport",
        responseHash,
        ethers.encodeBytes32String("annotation")
      )
    ).wait();

    log.success("Validation response submitted: score=85");
    log.waiting("Listening for next job submission...");
  }
}

main().catch((err) => {
  console.error("[EVALUATOR] Fatal:", err.message);
  process.exit(1);
});
