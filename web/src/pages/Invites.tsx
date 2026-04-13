import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { THEME, styles } from '../lib/theme'

interface InviteRecord {
  nonce: number
  inviter: string
  clientAddress: string
  clientDid: string | null
  claimed: boolean
  claimedAt: string | null
  createdAt: string
}

interface InviteData {
  total: number
  claimed: number
  invites: InviteRecord[]
}

import { ENV } from '../config/env'
const INVITE_SERVICE_URL = ENV.INVITE_SERVICE_URL

export function Invites() {
  const [data, setData] = useState<InviteData | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false

    async function fetchInvites() {
      try {
        setLoading(true)
        const res = await fetch(`${INVITE_SERVICE_URL}/invites`)
        if (!res.ok) throw new Error(`HTTP ${res.status}`)
        const json = await res.json()
        if (!cancelled) { setData(json); setError(null) }
      } catch (err: any) {
        if (!cancelled) setError(`Cannot connect to Invite Service (${INVITE_SERVICE_URL}). Is it running?`)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchInvites()
    const interval = setInterval(fetchInvites, 5000) // Auto-refresh
    return () => { cancelled = true; clearInterval(interval) }
  }, [])

  if (loading && !data) return <p>Loading invite records...</p>

  if (error) {
    return (
      <div>
        <h2>Invited Users</h2>
        <div style={{ ...styles.card, background: 'rgba(239,68,68,0.04)' }}>
          <p style={{ margin: 0, color: THEME.danger }}>{error}</p>
        </div>
      </div>
    )
  }

  if (!data) return null

  return (
    <div>
      <h2>Invited Users</h2>

      {/* Summary */}
      <div style={{ display: 'flex', gap: 16, marginBottom: 24 }}>
        <StatCard label="Total Invites" value={data.total} />
        <StatCard label="Claimed" value={data.claimed} color={THEME.success} />
      </div>

      {/* Table */}
      {data.invites.length === 0 ? (
        <p style={{ color: THEME.textMuted }}>
          No invites yet. Start a client to trigger A2A consultation and generate invite codes.
        </p>
      ) : (
        <div style={styles.section}>
          <table style={styles.table}>
            <thead>
              <tr>
                <th style={styles.th}>Nonce</th>
                <th style={styles.th}>Inviter</th>
                <th style={styles.th}>Client</th>
                <th style={styles.th}>DID</th>
                <th style={styles.th}>Status</th>
                <th style={styles.th}>Created</th>
              </tr>
            </thead>
            <tbody>
              {data.invites.map((inv, i) => (
                <tr key={i}>
                  <td style={styles.td}>{inv.nonce}</td>
                  <td style={{ ...styles.td, ...styles.mono }}>{inv.inviter.slice(0, 10)}...</td>
                  <td style={{ ...styles.td, ...styles.mono }}>{inv.clientAddress.slice(0, 10)}...</td>
                  <td style={styles.td}>
                    {inv.clientDid ? (
                      <Link to={`/did/${inv.clientDid.replace('did:codatta:', '')}`} style={{ ...styles.mono }}>
                        {inv.clientDid.slice(0, 32)}...
                      </Link>
                    ) : (
                      <span style={{ color: THEME.textMuted }}>—</span>
                    )}
                  </td>
                  <td style={styles.td}>
                    <span style={inv.claimed ? styles.badge(THEME.success) : styles.badge(THEME.accentOrange)}>
                      {inv.claimed ? 'Claimed' : 'Pending'}
                    </span>
                  </td>
                  <td style={{ ...styles.td, fontSize: 12, color: THEME.textMuted }}>
                    {new Date(inv.createdAt).toLocaleTimeString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p style={{ fontSize: 12, color: THEME.textMuted, marginTop: 16 }}>
        Auto-refreshes every 5 seconds. Data from Invite Service at {INVITE_SERVICE_URL}/invites
      </p>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ ...styles.card, minWidth: 120, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 'bold', color: color || THEME.textPrimary }}>{value}</div>
      <div style={{ fontSize: 13, color: THEME.textMuted }}>{label}</div>
    </div>
  )
}
