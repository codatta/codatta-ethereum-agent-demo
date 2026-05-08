import { useEffect, useState } from 'react'

/**
 * Public x402 Bazaar — backed by Coinbase CDP's discovery endpoint.
 *
 * The standard x402 Bazaar API (extensions discovery.listResources) is hosted
 * by Coinbase CDP at /platform/v2/x402/discovery/resources. www.x402.org's
 * facilitator only exposes /supported, /verify, /settle — no catalog.
 *
 * CDP doesn't send CORS headers, so we go through vite's dev proxy at
 * `/bazaar-api` (see web/vite.config.ts). For prod, swap this base for a
 * real backend proxy that fronts the same CDP endpoint.
 *
 * The endpoint accepts `pageSize` (max 100) and `offset` for pagination, but
 * has no server-side search; callers do client-side filtering on the visible
 * page (description / resource URL / network / payTo).
 */
const BAZAAR_API = '/bazaar-api/discovery/resources'

export interface BazaarAccept {
  amount?: string
  asset?: string
  network?: string
  payTo?: string
  scheme?: string
  maxTimeoutSeconds?: number
  extra?: { name?: string; version?: string; feePayer?: string }
}

export interface BazaarItem {
  resource: string
  type: string
  description?: string
  accepts: BazaarAccept[]
  lastUpdated?: string
  metadata?: Record<string, unknown>
  extensions?: { bazaar?: { info?: Record<string, unknown>; schema?: Record<string, unknown> } }
}

interface BazaarResponse {
  x402Version: number
  items: BazaarItem[]
  pagination: { limit: number; offset: number; total: number }
}

export function usePublicBazaar(page: number, pageSize: number) {
  const [items, setItems] = useState<BazaarItem[]>([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    setLoading(true)
    setError(null)

    const offset = page * pageSize
    const url = `${BAZAAR_API}?pageSize=${pageSize}&offset=${offset}`

    fetch(url)
      .then(async (res) => {
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        return (await res.json()) as BazaarResponse
      })
      .then((data) => {
        if (cancelled) return
        setItems(data.items ?? [])
        setTotal(data.pagination?.total ?? 0)
      })
      .catch((err) => {
        if (!cancelled) setError(err.message ?? String(err))
      })
      .finally(() => {
        if (!cancelled) setLoading(false)
      })

    return () => {
      cancelled = true
    }
  }, [page, pageSize])

  return { items, total, loading, error }
}
