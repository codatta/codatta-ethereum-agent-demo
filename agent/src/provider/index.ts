import { ethers } from "ethers";
import express from "express";
import fs from "fs";
import path from "path";
import { provider, getWallet, addresses, PROVIDER_PORT } from "../shared/config.js";
import {
  DIDRegistrarABI, DIDRegistryABI,
  IdentityRegistryABI, ValidationRegistryABI, ReputationRegistryABI,
} from "../shared/abis.js";
import { buildFeedbackAuth } from "../shared/feedback-auth.js";
import * as log from "../shared/logger.js";

log.setRole("provider");

const wallet = getWallet("DEPLOYER_PRIVATE_KEY");
const didRegistrar = new ethers.Contract(addresses.didRegistrar, DIDRegistrarABI, wallet);
const didRegistry = new ethers.Contract(addresses.didRegistry, DIDRegistryABI, wallet);
const identity = new ethers.Contract(addresses.identityRegistry, IdentityRegistryABI, wallet);
const validationReg = new ethers.Contract(addresses.validationRegistry, ValidationRegistryABI, wallet);
const reputation = new ethers.Contract(addresses.reputationRegistry, ReputationRegistryABI, provider);

const AGENT_INFO_FILE = path.join(import.meta.dirname, "../../agent-info.json");

async function main() {
  const network = await provider.getNetwork();
  log.header(`Provider Agent — Chain ${network.chainId}`);
  log.info("Address:", wallet.address);

  // ── Step 1: Register Codatta DID ──────────────────────────────
  log.step("Registering Codatta DID");

  const didTx = await didRegistrar.register();
  const didReceipt = await didTx.wait();

  const didEvent = didReceipt.logs
    .map((l: ethers.Log) => {
      try { return didRegistry.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "DIDRegistered");

  const codattaDid: bigint = didEvent!.args.identifier;
  log.info("Codatta DID:", `did:codatta:${codattaDid.toString(16)}`);

  // ── Step 2: Register in ERC-8004 ──────────────────────────────
  log.step("Registering agent in ERC-8004");

  const serviceEndpointUrl = `http://localhost:${PROVIDER_PORT}`;

  const registrationFile = {
    type: "https://eips.ethereum.org/EIPS/eip-8004#registration-v1",
    name: "Codatta Annotation Agent",
    description:
      "AI agent for image annotation in the Codatta data production ecosystem. " +
      "Supports object detection labeling, semantic segmentation, and classification.",
    image: "https://codatta.io/agents/annotation/avatar.png",
    services: [
      { name: "web", endpoint: serviceEndpointUrl },
      { name: "DID", endpoint: `did:codatta:${codattaDid.toString(16)}`, version: "v1" },
    ],
    active: true,
    registrations: [] as { agentId: string; agentRegistry: string }[],
    supportedTrust: ["reputation"],
    x402Support: true,
  };

  const agentURI = `data:application/json;base64,${Buffer.from(JSON.stringify(registrationFile)).toString("base64")}`;
  const regTx = await identity.register(agentURI);
  const regReceipt = await regTx.wait();

  const regEvent = regReceipt.logs
    .map((l: ethers.Log) => {
      try { return identity.interface.parseLog({ topics: [...l.topics], data: l.data }); }
      catch { return null; }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "Registered");

  const agentId: bigint = regEvent!.args.agentId;
  log.info("Agent ID:", agentId.toString());

  // Update registration with agentId
  registrationFile.registrations.push({
    agentId: agentId.toString(),
    agentRegistry: addresses.identityRegistry,
  });
  const updatedURI = `data:application/json;base64,${Buffer.from(JSON.stringify(registrationFile)).toString("base64")}`;
  await (await identity.setAgentUri(agentId, updatedURI)).wait();

  // ── Step 3: Link DID ↔ ERC-8004 ──────────────────────────────
  log.step("Linking DID ↔ ERC-8004");

  await (await identity.setMetadata(
    agentId, "codatta:did",
    ethers.AbiCoder.defaultAbiCoder().encode(["uint128"], [codattaDid])
  )).wait();

  const didServiceEndpoint = JSON.stringify({
    id: `did:codatta:${codattaDid.toString(16)}#erc8004`,
    type: "ERC8004Agent",
    serviceEndpoint: `eip155:${network.chainId}:${addresses.identityRegistry}#${agentId}`,
  });
  await (await didRegistry.addItemToAttribute(
    codattaDid, codattaDid, "service",
    ethers.toUtf8Bytes(didServiceEndpoint)
  )).wait();

  log.info("DID → ERC-8004:", `agentId=${agentId}`);
  log.info("ERC-8004 → DID:", `did:codatta:${codattaDid.toString(16)}`);
  log.success("Dual identity established");

  // Write agent info for client discovery
  fs.writeFileSync(AGENT_INFO_FILE, JSON.stringify({
    agentId: agentId.toString(),
    did: `did:codatta:${codattaDid.toString(16)}`,
  }));

  // ── Step 4: Start HTTP annotation service ─────────────────────
  log.step("Starting annotation service");

  const app = express();
  app.use(express.json());

  // POST /annotate — annotation service
  // In production: x402 middleware handles payment before this runs.
  // For local demo: payment is simulated, proceeds directly.
  app.post("/annotate", async (req, res) => {
    const { images, task } = req.body;
    log.event("Request received", `${images?.length || 0} images, task=${task}`);

    // Simulate annotation work
    log.info("Annotating...");
    await new Promise((r) => setTimeout(r, 2000));

    const annotations = (images || []).map((img: string, i: number) => ({
      image: img,
      labels: [
        { class: "car", bbox: [100 + i, 200, 300, 400], confidence: 0.95 },
        { class: "pedestrian", bbox: [400 + i, 150, 500, 450], confidence: 0.88 },
      ],
    }));

    log.success(`Annotation complete: ${annotations.length} images`);

    // Build feedbackAuth for client to submit reputation feedback
    const clientAddress = req.headers["x-client-address"] as string || "";
    let feedbackAuth = "";
    try {
      if (clientAddress) {
        feedbackAuth = await buildFeedbackAuth({
          agentId,
          clientAddress,
          indexLimit: 1,
          expiry: Math.floor(Date.now() / 1000) + 86400,
          chainId: network.chainId,
          identityRegistry: addresses.identityRegistry,
          signerWallet: wallet,
        });
      }
    } catch (e: any) {
      log.info("feedbackAuth build failed:", e.message);
    }

    // Update validation registry on-chain
    const requestHash = ethers.keccak256(ethers.toUtf8Bytes(`annotation-${Date.now()}`));
    try {
      await (await validationReg.validationRequest(
        wallet.address, agentId,
        "ipfs://QmAnnotationResult", requestHash
      )).wait();
      await (await validationReg.validationResponse(
        requestHash, 90,
        "ipfs://QmValidationReport",
        ethers.keccak256(ethers.toUtf8Bytes("validation-ok")),
        ethers.encodeBytes32String("annotation")
      )).wait();
      log.info("Validation updated on-chain");
    } catch (e: any) {
      log.info("Validation update skipped:", e.message);
    }

    res.json({
      status: "completed",
      annotations,
      agentId: agentId.toString(),
      feedbackAuth,
    });
  });

  app.get("/health", (_req, res) => {
    res.json({ status: "ok", agentId: agentId.toString(), active: true });
  });

  app.listen(PROVIDER_PORT, () => {
    log.success(`Annotation service running on http://localhost:${PROVIDER_PORT}`);
    log.info("  POST /annotate  — submit images for annotation");
    log.info("  GET  /health    — health check");
    log.waiting("Waiting for requests...");
  });
}

main().catch((err) => {
  console.error("[PROVIDER] Fatal:", err.message);
  process.exit(1);
});
