import { ethers } from "ethers";
import { getContracts } from "../contracts.js";
import { addresses, client } from "../config.js";
import * as log from "../utils/logger.js";

const JOB_BUDGET = ethers.parseEther("1000");

export async function fundJob(jobId: bigint): Promise<void> {
  log.step(3, "Fund Job");

  const { acpAsClient, tokenAsClient, token } = getContracts();

  // Mint tokens to client if needed (local/testnet)
  const balance = await token.balanceOf(client.address);
  if (balance < JOB_BUDGET) {
    await (await token.mint(client.address, ethers.parseEther("10000"))).wait();
    log.info("Minted 10000 XNY to client");
  }

  // Set budget
  await (await acpAsClient.setBudget(jobId, JOB_BUDGET, "0x")).wait();
  log.info("Budget set:", ethers.formatEther(JOB_BUDGET) + " XNY");

  // Approve and fund
  await (await tokenAsClient.approve(addresses.acpContract, JOB_BUDGET)).wait();
  await (await acpAsClient.fund(jobId, JOB_BUDGET, "0x")).wait();

  log.success(`Job funded with ${ethers.formatEther(JOB_BUDGET)} XNY`);
}

export { JOB_BUDGET };
