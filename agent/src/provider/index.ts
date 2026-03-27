import { ethers } from "ethers";
import fs from "fs";
import path from "path";
import { provider, getWallet, addresses } from "../shared/config.js";
import {
  IdentityRegistryABI, ACPContractABI, ValidationRegistryABI,
  ReputationRegistryABI, MockERC20ABI,
} from "../shared/abis.js";
import { waitForEvent } from "../shared/events.js";
import { buildFeedbackAuth } from "../shared/feedback-auth.js";
import * as log from "../shared/logger.js";

log.setRole("provider");

const wallet = getWallet("DEPLOYER_PRIVATE_KEY");
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
const acp = new ethers.Contract(addresses.acpContract, ACPContractABI, wallet);
const validationReg = new ethers.Contract(addresses.validationRegistry, ValidationRegistryABI, wallet);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, provider);
const token = new ethers.Contract(addresses.tokenContract, MockERC20ABI, provider);

const FEEDBACK_AUTH_FILE = path.join(import.meta.dirname, "../../feedback-auth.json");
const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

async function main() {
  const network = await provider.getNetwork();
  log.header(`Provider Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // Step 1: Register in ERC-8004 with Agent URI document
  log.step("Registering agent in ERC-8004");

  // Agent URI document — describes who this agent is and how to interact with it
  // In production this would be hosted at a real URL; for demo we use a data URI
  const agentDocument = {
    name: "Codatta Demo Annotator",
    description: "AI agent for data annotation and validation tasks",
    owner: wallet.address,
    endpoints: [
      {
        name: "MCP",
        endpoint: "https://codatta.io/mcp/demo-annotator",
        protocol: "mcp/1.0",
      },
      {
        name: "A2A",
        endpoint: "https://codatta.io/a2a/demo-annotator",
        protocol: "a2a/1.0",
      },
      {
        name: "Codatta",
        endpoint: "https://codatta.io/agent/demo-annotator",
        capabilities: {
          roles: ["annotator", "validator"],
          frontiers: ["data-annotation", "data-validation"],
        },
      },
    ],
    // TODO: Evaluator discovery — currently hardcoded, should be provided by
    // a separate evaluator registry service in production
    preferredEvaluators: [],
  };

  const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(agentDocument)).toString("base64")}`;
  const tx = await identity.register(agentURI);
  const receipt = await tx.wait();

  const regEvent = receipt.logs
    .map((l: ethers.Log) => {
      try { return identity.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "Registered");

  const agentId: bigint = regEvent!.args.agentId;
  log.info("Agent ID:", agentId.toString());
  log.info("Agent URI:", "data:application/json;base64,... (agent document)");
  log.info("MCP endpoint:", agentDocument.endpoints[0].endpoint);
  log.info("A2A endpoint:", agentDocument.endpoints[1].endpoint);

  // Set Codatta DID metadata
  const codattaDid = BigInt("0x12345678abcdef0012345678abcdef00");
  await (await identity.setMetadata(
    agentId, "codatta:did",
    ethers.AbiCoder.defaultAbiCoder().encode(["uint128"], [codattaDid])
  )).wait();
  log.info("Codatta DID:", `0x${codattaDid.toString(16)}`);

  log.success("Agent registered with document, DID, and capabilities");

  // Write agent info for discovery (in production this would be a marketplace service)
  fs.writeFileSync(AGENT_INFO_FILE, JSON.stringify({ agentId: agentId.toString() }));

  log.waiting("Listening for jobs...");

  // Listen for JobCreated where provider == self
  const jobArgs = await waitForEvent(
    acp, "JobCreated",
    (_jobId, _client, prov) => (prov as string).toLowerCase() === wallet.address.toLowerCase()
  );

  const jobId = jobArgs[0] as bigint;
  const clientAddr = jobArgs[1] as string;
  log.event("JobCreated", `jobId=${jobId} from client ${clientAddr}`);

  // Wait for funding
  log.waiting("Waiting for job to be funded...");
  await waitForEvent(
    acp, "JobFunded",
    (id: unknown) => (id as bigint) === jobId
  );
  log.event("JobFunded", `jobId=${jobId}`);

  // Simulate work
  log.step("Executing work");
  log.info("Simulating data annotation...");
  await new Promise((r) => setTimeout(r, 2000));

  const deliverable = "ipfs://QmMockDeliverable12345";
  await (await acp.submit(jobId, deliverable, "0x")).wait();
  log.success(`Work submitted: ${deliverable}`);

  // Wait for completion
  log.waiting("Waiting for evaluator to complete job...");
  await waitForEvent(
    acp, "JobCompleted",
    (id: unknown) => (id as bigint) === jobId
  );
  log.event("JobCompleted", `jobId=${jobId}`);

  // Request validation
  log.step("Requesting validation");
  const requestHash = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "string"], [jobId, deliverable]
    )
  );

  const evaluatorAddr = (await acp.getJob(jobId))[2];
  await (await validationReg.validationRequest(
    evaluatorAddr, agentId, "ipfs://QmMockValidationRequest", requestHash
  )).wait();
  log.success("Validation requested");

  // Pre-sign feedbackAuth for Client
  log.step("Signing feedbackAuth for client");
  const feedbackAuth = await buildFeedbackAuth({
    agentId,
    clientAddress: clientAddr,
    indexLimit: 10,
    expiry: Math.floor(Date.now() / 1000) + 3600,
    chainId: network.chainId,
    identityRegistry: addresses.identityRegistry,
    signerWallet: wallet,
  });

  fs.writeFileSync(FEEDBACK_AUTH_FILE, JSON.stringify({
    agentId: agentId.toString(),
    feedbackAuth: ethers.hexlify(feedbackAuth),
    clientAddress: clientAddr,
  }));
  log.success("feedbackAuth written to feedback-auth.json");

  // Query final state
  log.step("Final state");
  const score = await reputation.getScore(agentId);
  // Wait a bit for reputation to be written by client
  await new Promise((r) => setTimeout(r, 5000));
  const finalScore = await reputation.getScore(agentId);
  const balance = await token.balanceOf(wallet.address);

  log.summary({
    "Agent ID": agentId.toString(),
    "Codatta DID": `0x${codattaDid.toString(16)}`,
    "Reputation Score": finalScore.toString(),
    "Balance": ethers.formatEther(balance) + " XNY",
  });
}

main().catch((err) => {
  console.error("[PROVIDER] Fatal:", err.message);
  process.exit(1);
});
