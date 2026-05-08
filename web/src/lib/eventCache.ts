/**
 * Persistent event-log cache backed by localStorage.
 *
 * Each (chainId, contract, event[, indexed args]) pair gets its own bucket
 * keyed by the caller. On a refresh, only the delta since `lastBlock` is
 * fetched — historical logs are reused from cache.
 *
 * No reorg protection: `latestBlock` is treated as final. Fine for demo
 * deployments. If reused on a chain with frequent reorgs, hold back the
 * last N blocks (e.g. N=20) from the cache and re-scan each load.
 *
 * Falls back to a full chunked scan if localStorage is unavailable or the
 * cache entry is corrupt — the cache is purely an optimization.
 */

const STORAGE_PREFIX = 'evt:'

// Block range per getLogs request — public RPCs (Alchemy / Infura / Base
// public) reject ranges wider than ~10k blocks.
const CHUNK_SIZE = 9_000n

interface Cached<T> {
  lastBlock: bigint
  logs: T[]
}

// localStorage holds strings only; BigInt fields on viem `Log` (blockNumber,
// transactionIndex, logIndex, blockTimestamp) need round-trip via tagged
// objects so we don't lose precision.
function replacer(_k: string, v: unknown) {
  return typeof v === 'bigint' ? { __bigint: v.toString() } : v
}

function reviver(_k: string, v: any) {
  return v && typeof v === 'object' && typeof v.__bigint === 'string'
    ? BigInt(v.__bigint)
    : v
}

function readCache<T>(key: string): Cached<T> | null {
  try {
    const raw = localStorage.getItem(STORAGE_PREFIX + key)
    if (!raw) return null
    const parsed = JSON.parse(raw, reviver)
    if (!parsed || typeof parsed.lastBlock !== 'bigint' || !Array.isArray(parsed.logs)) return null
    return parsed
  } catch {
    return null
  }
}

function writeCache<T>(key: string, value: Cached<T>) {
  try {
    localStorage.setItem(STORAGE_PREFIX + key, JSON.stringify(value, replacer))
  } catch {
    // Quota exceeded or storage disabled — silently skip; correctness is
    // preserved, only the next refresh will pay the full scan cost.
  }
}

/**
 * Read events for `key`, fetching only the range above the last cached
 * block. On miss, scans `[deploymentBlock, latestBlock]` chunked.
 */
export async function getCachedEvents<T>(
  key: string,
  deploymentBlock: bigint,
  latestBlock: bigint,
  fetchRange: (from: bigint, to: bigint) => Promise<T[]>,
): Promise<T[]> {
  const cached = readCache<T>(key)
  const baseLogs = cached?.logs ?? []
  const from = cached ? cached.lastBlock + 1n : deploymentBlock

  if (from > latestBlock) return baseLogs

  const newLogs: T[] = []
  let cursor = from
  while (cursor <= latestBlock) {
    const candidate = cursor + CHUNK_SIZE - 1n
    const to = candidate > latestBlock ? latestBlock : candidate
    const chunk = await fetchRange(cursor, to)
    newLogs.push(...chunk)
    cursor = to + 1n
  }

  const merged = baseLogs.concat(newLogs)
  writeCache<T>(key, { lastBlock: latestBlock, logs: merged })
  return merged
}
