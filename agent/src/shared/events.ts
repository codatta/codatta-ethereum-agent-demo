import { ethers } from "ethers";

// Block range per getLogs request. Public RPCs (sepolia.base.org / Alchemy /
// Infura / drpc) reject ranges wider than ~10k blocks; 9_000 leaves headroom.
const SCAN_CHUNK_BLOCKS = 9_000;

/**
 * Chunked queryFilter — slices a single conceptual scan into RPC-safe ranges
 * and accumulates results. Pass the contract's deployment block as
 * `fromBlock` so we don't burn requests scanning empty pre-deploy history.
 */
export async function queryFilterChunked(
  contract: ethers.Contract,
  filter: ethers.ContractEventName,
  fromBlock: number,
  toBlock?: number,
): Promise<(ethers.EventLog | ethers.Log)[]> {
  const provider = contract.runner!.provider!;
  const latest = toBlock ?? await provider.getBlockNumber();
  if (fromBlock > latest) return [];

  const all: (ethers.EventLog | ethers.Log)[] = [];
  let from = fromBlock;
  while (from <= latest) {
    const to = Math.min(from + SCAN_CHUNK_BLOCKS - 1, latest);
    const chunk = await contract.queryFilter(filter, from, to);
    all.push(...chunk);
    from = to + 1;
  }
  return all;
}

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
