import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { deployer } from "../config.js";
import * as log from "../utils/logger.js";

export async function registerAgent(): Promise<bigint> {
  log.step(1, "Register Agent in ERC-8004");

  const { identity } = getContracts();

  // Register agent with URI
  const tx = await identity.register(
    "https://codatta.io/agents/demo-annotator"
  );
  const receipt = await tx.wait();

  // Extract agentId from Registered event
  const event = receipt.logs
    .map((l: ethers.Log) => {
      try {
        return identity.interface.parseLog({ topics: [...l.topics], data: l.data });
      } catch {
        return null;
      }
    })
    .find((e: ethers.LogDescription | null) => e?.name === "Registered");

  const agentId: bigint = event!.args.agentId;
  log.info("Agent ID:", agentId.toString());
  log.info("Owner:", deployer.address);

  // Set Codatta DID metadata
  const codattaDid = BigInt("0x12345678abcdef0012345678abcdef00");
  const didBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ["uint128"],
    [codattaDid]
  );
  await (await identity.setMetadata(agentId, "codatta:did", didBytes)).wait();
  log.info("Codatta DID linked:", `0x${codattaDid.toString(16)}`);

  // Set capabilities
  const capBytes = ethers.AbiCoder.defaultAbiCoder().encode(
    ["string"],
    ["annotator,validator"]
  );
  await (
    await identity.setMetadata(agentId, "codatta:capabilities", capBytes)
  ).wait();
  log.success("Agent registered with capabilities: annotator, validator");

  return agentId;
}
