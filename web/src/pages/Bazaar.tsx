import { Link } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'
import { useBazaarCatalog, type BazaarItem, type ProviderCatalog } from '../hooks/useBazaarCatalog'
import { THEME, styles } from '../lib/theme'

function formatPrice(item: BazaarItem): { label: string; free: boolean } {
  if (!item.accepts || item.accepts.length === 0) return { label: 'Free', free: true }
  const first = item.accepts[0] as {
    amount?: string | number
    asset?: string
    extra?: { name?: string }
    price?: { amount?: string | number; extra?: { name?: string } }
  }
  const amount = first.amount ?? first.price?.amount
  const tokenName = first.extra?.name ?? first.price?.extra?.name ?? 'USDC'
  if (amount === undefined) return { label: 'Paid', free: false }
  // Demo provider always uses 6-decimal stablecoin (USDC / MockERC3009).
  const human = Number(amount) / 1e6
  const display = Number.isFinite(human) ? human : amount
  return { label: `${display} ${tokenName}`, free: false }
}

function summarizeSchema(schema: unknown): string {
  if (!schema || typeof schema !== 'object') return ''
  const s = schema as { properties?: Record<string, { type?: string | string[] }>; required?: string[] }
  const props = s.properties
  if (!props) return ''
  const required = new Set(s.required ?? [])
  const parts = Object.keys(props).map(k => {
    const t = props[k]?.type
    const star = required.has(k) ? '*' : ''
    const typeLabel = Array.isArray(t) ? t.join('|') : (t || '?')
    return `${k}${star}: ${typeLabel}`
  })
  return parts.join(', ')
}

function pickInputSchema(item: BazaarItem): unknown {
  const bz = item.bazaar
  if (!bz) return null
  const schema = (bz.schema ?? {}) as Record<string, unknown>
  if (schema.input) return schema.input
  const info = bz.info as Record<string, unknown> | undefined
  if (info?.inputSchema) return info.inputSchema
  return schema
}

function statusBadgeColor(status: ProviderCatalog['status']): string {
  if (status === 'ok') return THEME.success
  if (status === 'unreachable') return THEME.danger
  return THEME.textMuted
}

function statusBadgeText(p: ProviderCatalog): string {
  if (p.status === 'ok') return `${p.items.length} resource${p.items.length === 1 ? '' : 's'}`
  if (p.status === 'unreachable') return 'unreachable'
  if (p.status === 'no-web') return 'no web endpoint'
  return 'loading…'
}

export function Bazaar() {
  const { agents, loading: agentsLoading } = useAgentList()
  const { providers, loading } = useBazaarCatalog(agents)

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>x402 Bazaar</h2>
      <p style={{ color: THEME.textSecondary, marginBottom: 24 }}>
        Live discovery feed from each registered provider's <code>/discovery/resources</code>.
        HTTP and MCP resources advertised here can be invoked over x402 directly.
      </p>

      {(agentsLoading || loading) && providers.length === 0 && (
        <p style={{ color: THEME.textMuted }}>Loading bazaar catalog…</p>
      )}

      {!agentsLoading && providers.length === 0 && (
        <p style={{ color: THEME.textMuted }}>No active providers found.</p>
      )}

      <div style={{ display: 'grid', gap: 16 }}>
        {providers.map(p => (
          <div key={p.key} style={styles.card}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginBottom: 12 }}>
              <div style={{ flex: 1, minWidth: 0 }}>
                <Link to={p.link} style={{ textDecoration: 'none', color: 'inherit' }}>
                  <h3 style={{ margin: '0 0 4px', fontSize: 16, fontWeight: 600 }}>{p.name}</h3>
                </Link>
                {p.description && (
                  <p style={{ margin: 0, fontSize: 13, color: THEME.textSecondary, lineHeight: 1.6 }}>
                    {p.description}
                  </p>
                )}
                {p.webEndpoint && (
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: THEME.textMuted, fontFamily: 'monospace', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {p.webEndpoint}
                  </p>
                )}
              </div>
              <span style={{ ...styles.badge(statusBadgeColor(p.status)), flexShrink: 0, marginLeft: 12 }}>
                {statusBadgeText(p)}
              </span>
            </div>

            {p.status === 'ok' && p.items.length > 0 && (
              <div style={{ display: 'grid', gap: 8 }}>
                {p.items.map((item, i) => {
                  const price = formatPrice(item)
                  const schema = pickInputSchema(item)
                  const schemaSummary = summarizeSchema(schema)
                  return (
                    <div
                      key={`${p.key}-${i}-${item.resource}`}
                      style={{
                        padding: '10px 12px',
                        borderRadius: 8,
                        background: THEME.warmWhite,
                        border: THEME.border,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
                        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flex: 1, minWidth: 0 }}>
                          <span style={styles.badge(item.type === 'http' ? THEME.blue : THEME.teal)}>
                            {item.type}
                          </span>
                          <code style={{ fontSize: 12, color: THEME.textPrimary, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
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
                        <p style={{ margin: '6px 0 0', fontSize: 12, color: THEME.textSecondary }}>
                          {item.description}
                        </p>
                      )}
                      {schemaSummary && (
                        <p style={{ margin: '6px 0 0', fontSize: 11, color: THEME.textMuted, fontFamily: 'monospace' }}>
                          input: {schemaSummary}
                        </p>
                      )}
                    </div>
                  )
                })}
              </div>
            )}

            {p.status === 'ok' && p.items.length === 0 && (
              <p style={{ margin: 0, fontSize: 12, color: THEME.textMuted }}>
                Provider exposes <code>/discovery/resources</code> but the catalog is empty.
              </p>
            )}

            {p.status === 'unreachable' && (
              <p style={{ margin: 0, fontSize: 12, color: THEME.textMuted }}>
                Could not fetch catalog{p.error ? ` — ${p.error}` : ''}.
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  )
}
