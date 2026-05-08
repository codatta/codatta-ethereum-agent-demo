import { useMemo, useState } from 'react'
import { usePublicBazaar, type BazaarAccept, type BazaarItem } from '../hooks/useBazaarCatalog'
import { THEME, styles } from '../lib/theme'

const PAGE_SIZE = 20

function formatAccept(accept: BazaarAccept): { label: string; free: boolean } {
  if (!accept) return { label: 'Free', free: true }
  const amount = accept.amount
  if (amount === undefined || amount === null) return { label: 'Free', free: true }
  // Almost all bazaar accepts use 6-decimal stablecoins (USDC across chains).
  // Show 6-decimal humanized; if asset doesn't fit the assumption it'll just
  // look big — acceptable for a discovery surface.
  const human = Number(amount) / 1e6
  const display = Number.isFinite(human) ? human : amount
  const tokenName = accept.extra?.name ?? 'USDC'
  return { label: `${display} ${tokenName}`, free: false }
}

function networkLabel(network?: string): string {
  if (!network) return ''
  // eip155:8453 → Base, eip155:84532 → Base Sepolia, etc.
  const knownEvm: Record<string, string> = {
    '8453': 'Base',
    '84532': 'Base Sepolia',
    '1': 'Ethereum',
    '11155111': 'Sepolia',
    '42161': 'Arbitrum',
    '10': 'Optimism',
  }
  if (network.startsWith('eip155:')) {
    const id = network.slice(7)
    return knownEvm[id] ?? `EVM ${id}`
  }
  if (network.startsWith('solana:')) return 'Solana'
  if (network.startsWith('algorand:')) return 'Algorand'
  if (network.startsWith('aptos:')) return 'Aptos'
  if (network.startsWith('stellar:')) return 'Stellar'
  return network
}

function matches(item: BazaarItem, query: string): boolean {
  if (!query) return true
  const q = query.toLowerCase()
  if (item.resource?.toLowerCase().includes(q)) return true
  if (item.description?.toLowerCase().includes(q)) return true
  if (item.type?.toLowerCase().includes(q)) return true
  for (const a of item.accepts ?? []) {
    if (a.network && networkLabel(a.network).toLowerCase().includes(q)) return true
    if (a.payTo?.toLowerCase().includes(q)) return true
    if (a.asset?.toLowerCase().includes(q)) return true
  }
  return false
}

export function Bazaar() {
  const [page, setPage] = useState(0)
  const [search, setSearch] = useState('')
  const { items, total, loading, error } = usePublicBazaar(page, PAGE_SIZE)

  const filtered = useMemo(() => items.filter(i => matches(i, search)), [items, search])
  const lastPage = Math.max(0, Math.ceil(total / PAGE_SIZE) - 1)

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: 8, gap: 12, flexWrap: 'wrap' }}>
        <h2 style={{ fontSize: 24, fontWeight: 700, margin: 0 }}>x402 Bazaar</h2>
        <span style={{ fontSize: 13, color: THEME.textMuted }}>
          {total > 0 ? `${total.toLocaleString()} resources discoverable on the public x402 network` : '—'}
        </span>
      </div>
      <p style={{ color: THEME.textSecondary, marginBottom: 16, fontSize: 14 }}>
        Live feed from Coinbase CDP's public Bazaar (
        <code style={{ fontSize: 12 }}>api.cdp.coinbase.com/platform/v2/x402/discovery/resources</code>
        ). Each entry is a resource that has been settled at least once through the public x402 facilitator.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, alignItems: 'center', flexWrap: 'wrap' }}>
        <input
          type="text"
          value={search}
          onChange={e => setSearch(e.target.value)}
          placeholder="Search current page (URL / description / network / address)"
          style={{
            flex: 1,
            minWidth: 240,
            padding: '8px 12px',
            border: THEME.border,
            borderRadius: THEME.radiusInput,
            fontSize: 14,
            background: THEME.surface,
            color: THEME.textPrimary,
          }}
        />
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 13, color: THEME.textSecondary }}>
          <button
            onClick={() => setPage(p => Math.max(0, p - 1))}
            disabled={page === 0 || loading}
            style={{
              ...styles.btnSecondary,
              opacity: page === 0 ? 0.5 : 1,
              cursor: page === 0 ? 'not-allowed' : 'pointer',
            }}
          >
            ← Prev
          </button>
          <span style={{ minWidth: 70, textAlign: 'center' }}>
            Page {page + 1} / {lastPage + 1}
          </span>
          <button
            onClick={() => setPage(p => Math.min(lastPage, p + 1))}
            disabled={page >= lastPage || loading}
            style={{
              ...styles.btnSecondary,
              opacity: page >= lastPage ? 0.5 : 1,
              cursor: page >= lastPage ? 'not-allowed' : 'pointer',
            }}
          >
            Next →
          </button>
        </div>
      </div>

      {loading && items.length === 0 && (
        <p style={{ color: THEME.textMuted }}>Loading bazaar catalog…</p>
      )}

      {error && (
        <p style={{ color: THEME.danger, fontSize: 13 }}>
          Failed to load bazaar: {error}
        </p>
      )}

      {!loading && filtered.length === 0 && items.length > 0 && (
        <p style={{ color: THEME.textMuted, fontSize: 13 }}>
          No resources on this page match "{search}". Navigate to other pages to see more.
        </p>
      )}

      <div style={{ display: 'grid', gap: 12 }}>
        {filtered.map((item, i) => {
          const accept = item.accepts?.[0]
          const price = formatAccept(accept)
          const network = networkLabel(accept?.network)
          return (
            <div
              key={`${page}-${i}-${item.resource}`}
              style={{
                ...styles.card,
                padding: '14px 16px',
              }}
            >
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12, marginBottom: 6 }}>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center', minWidth: 0, flex: 1 }}>
                  <span style={styles.badge(item.type === 'http' ? THEME.blue : THEME.teal)}>
                    {item.type}
                  </span>
                  {network && (
                    <span style={styles.badge(THEME.textMuted)}>{network}</span>
                  )}
                  <code style={{
                    fontSize: 12,
                    color: THEME.textPrimary,
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                    flex: 1,
                    minWidth: 0,
                  }}>
                    {item.resource}
                  </code>
                </div>
                <span style={{
                  ...styles.badge(price.free ? THEME.success : THEME.badgeBlueText),
                  flexShrink: 0,
                }}>
                  {price.label}
                </span>
              </div>
              {item.description && (
                <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary, lineHeight: 1.5 }}>
                  {item.description}
                </p>
              )}
              {accept?.payTo && (
                <p style={{ margin: '6px 0 0', fontSize: 11, color: THEME.textMuted, fontFamily: 'monospace' }}>
                  payTo: {accept.payTo}
                </p>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}
