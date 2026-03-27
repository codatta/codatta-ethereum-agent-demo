import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { provider, getWallet, addresses } from "../shared/config.js";
import {
  IdentityRegistryABI, ACPContractABI, MockERC20ABI, ReputationRegistryABI,
} from "../shared/abis.js";
import { waitForEvent } from "../shared/events.js";
import * as log from "../shared/logger.js";

log.setRole("client");

const wallet = getWallet("CLIENT_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, provider);
const acp = new ethers.Contract(addresses.acpContract, ACPContractABI, wallet);
const token = new ethers.Contract(addresses.tokenContract, MockERC20ABI, wallet);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, wallet);

const JOB_BUDGET = ethers.parseEther("1000");
const FEEDBACK_AUTH_FILE = path.join(import.meta.dirname, "../../feedback-auth.json");
const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

/**
 * In production, agentId comes from a marketplace/discovery service.
 * For demo, the Provider writes agent-info.json after registration;
 * the Client polls for it.
 */
async function discoverAgentId(): Promise<bigint> {
  log.info("Querying marketplace for agents... (reading agent-info.json)");
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(AGENT_INFO_FILE)) {
      try {
        const info = JSON.parse(fs.readFileSync(AGENT_INFO_FILE, "utf-8"));
        return BigInt(info.agentId);
      } catch { /* not ready */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error("Agent not found — is the Provider running?");
}

async function main() {
  const network = await provider.getNetwork();
  log.header(`Client Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // Step 1: Discover Agent from ERC-8004 Identity Registry
  // In production, agentId would come from a marketplace/discovery service.
  // For demo, we read it from the provider's output file.
  log.step("Discovering agent from ERC-8004");

  const agentId = await discoverAgentId();
  log.info("Agent ID:", agentId.toString());

  // Query agent document from on-chain
  const agentURI = await identity.tokenURI(agentId);
  const providerAddr = await identity.ownerOf(agentId) as string;

  let agentDocument: Record<string, unknown> = {};
  if (agentURI.startsWith("data:application/json;base64,")) {
    const base64 = agentURI.replace("data:application/json;base64,", "");
    agentDocument = JSON.parse(Buffer.from(base64, "base64").toString());
  }

  log.info("Agent name:", (agentDocument.name as string) || "unknown");
  log.info("Agent owner (provider):", providerAddr);

  const endpoints = (agentDocument.endpoints || []) as Array<{ name: string; endpoint: string }>;
  for (const ep of endpoints) {
    log.info(`  ${ep.name} endpoint:`, ep.endpoint);
  }

  // TODO: Evaluator discovery — in production, evaluator should be discovered
  // from a separate evaluator registry service. Currently hardcoded for demo.
  const evaluatorAddr = getWallet("EVALUATOR_PRIVATE_KEY").address;
  log.info("Evaluator:", `${evaluatorAddr} (TODO: evaluator discovery service)`);

  // Step 2: Prepare funds
  log.step("Preparing funds");
  await (await token.mint(wallet.address, ethers.parseEther("10000"))).wait();
  log.info("Minted 10000 XNY");

  // Step 3: Create job targeting the discovered agent
  log.step("Creating job for discovered agent");
  const expiredAt = Math.floor(Date.now() / 1000) + 86400;
  const tx = await acp.createJob(
    providerAddr,
    evaluatorAddr,
    expiredAt,
    "Annotate 100 images for object detection",
    addresses.hookContract
  );
  const receipt = await tx.wait();

  const jobEvent = receipt.logs
    .map((l: ethers.Log) => {
      try { return acp.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "JobCreated");

  const jobId: bigint = jobEvent!.args.jobId;
  log.info("Job ID:", jobId.toString());
  log.info("Description:", "Annotate 100 images for object detection");

  // Fund job
  log.step("Funding job");
  await (await acp.setBudget(jobId, JOB_BUDGET, "0x")).wait();
  await (await token.approve(addresses.acpContract, JOB_BUDGET)).wait();
  await (await acp.fund(jobId, JOB_BUDGET, "0x")).wait();
  log.success(`Job funded with ${ethers.formatEther(JOB_BUDGET)} XNY`);

  // Wait for completion
  log.waiting("Waiting for job to be completed...");
  await waitForEvent(
    acp, "JobCompleted",
    (id: unknown) => (id as bigint) === jobId
  );
  log.event("JobCompleted", `jobId=${jobId}`);

  // Read feedbackAuth from shared file (poll)
  log.step("Submitting reputation feedback");
  log.info("Waiting for feedbackAuth from provider...");

  let authData: { agentId: string; feedbackAuth: string } | null = null;
  for (let i = 0; i < 60; i++) {
    if (fs.existsSync(FEEDBACK_AUTH_FILE)) {
      try {
        authData = JSON.parse(fs.readFileSync(FEEDBACK_AUTH_FILE, "utf-8"));
        break;
      } catch { /* file not ready */ }
    }
    await new Promise((r) => setTimeout(r, 500));
  }

  if (!authData) {
    log.info("feedbackAuth not received within timeout");
    process.exit(1);
  }

  const agentId = BigInt(authData.agentId);
  log.info("Agent ID:", agentId.toString());

  // Give feedback
  const feedbackHash = ethers.keccak256(ethers.toUtf8Bytes("feedback-evidence"));
  await (
    await reputation.giveFeedback(
      agentId,
      90,
      ethers.encodeBytes32String("annotation"),
      ethers.encodeBytes32String("quality"),
      "ipfs://QmMockFeedbackReport",
      feedbackHash,
      authData.feedbackAuth
    )
  ).wait();
  log.success("Feedback submitted: score=90");

  // Query reputation
  const score = await reputation.getScore(agentId);
  log.summary({
    "Agent ID": agentId.toString(),
    "Reputation Score": score.toString(),
    "Job Status": "Completed",
  });

  // Clean up temp files
  try { fs.unlinkSync(FEEDBACK_AUTH_FILE); } catch {}
  try { fs.unlinkSync(AGENT_INFO_FILE); } catch {}
}

main().catch((err) => {
  console.error("[CLIENT] Fatal:", err.message);
  process.exit(1);
});
