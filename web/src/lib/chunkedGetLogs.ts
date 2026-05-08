/**
 * Block range per getLogs request. Public RPC providers (Alchemy / Infura /
 * Base public) reject ranges wider than ~10k blocks; 9_000 leaves headroom
 * for events emitted near the upper edge.
 */
const CHUNK_SIZE: bigint = 9_000n

/**
 * Generic chunked event scanner — call `fetchChunk(from, to)` repeatedly,
 * accumulating results, so a single conceptual "from start to latest" scan
 * never exceeds RPC limits.
 *
 * Callers stay typed by closing over their own `client.getLogs(...)` call
 * inside `fetchChunk` — this helper does not need to know event shapes.
 */
export async function chunkedGetLogs<T>(
  fromBlock: bigint,
  latestBlock: bigint,
  fetchChunk: (from: bigint, to: bigint) => Promise<T[]>,
  chunkSize: bigint = CHUNK_SIZE,
): Promise<T[]> {
  if (fromBlock > latestBlock) return []
  const out: T[] = []
  let from = fromBlock
  while (from <= latestBlock) {
    const candidate = from + chunkSize - 1n
    const to = candidate > latestBlock ? latestBlock : candidate
    const chunk = await fetchChunk(from, to)
    out.push(...chunk)
    from = to + 1n
  }
  return out
}
