import { ethers } from "ethers";

/**
 * Poll for a specific contract event using queryFilter.
 * Works reliably with Anvil HTTP RPC (no WebSocket needed).
 */
export async function waitForEvent(
  contract: ethers.Contract,
  eventName: string,
  filter?: (...args: unknown[]) => boolean,
  timeoutMs: number = 120_000,
  pollIntervalMs: number = 1000
): Promise<unknown[]> {
  const startBlock = await contract.runner!.provider!.getBlockNumber();
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const currentBlock = await contract.runner!.provider!.getBlockNumber();
    if (currentBlock >= startBlock) {
      const events = await contract.queryFilter(
        contract.filters[eventName](),
        startBlock,
        currentBlock
      );

      for (const ev of events) {
        const log = ev as ethers.EventLog;
        if (log.args) {
          const args = [...log.args];
          if (!filter || filter(...args)) {
            return args;
          }
        }
      }
    }

    await new Promise((r) => setTimeout(r, pollIntervalMs));
  }

  throw new Error(`Timeout waiting for event: ${eventName}`);
}
