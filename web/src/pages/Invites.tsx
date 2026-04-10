import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'

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

const INVITE_SERVICE_URL = 'http://127.0.0.1:4060'

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
        <div style={{ padding: 16, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
          <p style={{ margin: 0, color: '#dc2626' }}>{error}</p>
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
        <StatCard label="Claimed" value={data.claimed} color="#166534" />
      </div>

      {/* Table */}
      {data.invites.length === 0 ? (
        <p style={{ color: '#999' }}>
          No invites yet. Run the Client agent to trigger A2A consultation and generate invite codes.
        </p>
      ) : (
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Nonce</th>
              <th style={thStyle}>Inviter</th>
              <th style={thStyle}>Client</th>
              <th style={thStyle}>DID</th>
              <th style={thStyle}>Status</th>
              <th style={thStyle}>Created</th>
            </tr>
          </thead>
          <tbody>
            {data.invites.map((inv, i) => (
              <tr key={i}>
                <td style={tdStyle}>{inv.nonce}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{inv.inviter.slice(0, 10)}...</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{inv.clientAddress.slice(0, 10)}...</td>
                <td style={tdStyle}>
                  {inv.clientDid ? (
                    <Link to={`/did/${inv.clientDid.replace('did:codatta:', '')}`} style={{ fontFamily: 'monospace', fontSize: 12 }}>
                      {inv.clientDid.slice(0, 24)}...
                    </Link>
                  ) : (
                    <span style={{ color: '#999' }}>—</span>
                  )}
                </td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 12,
                    background: inv.claimed ? '#dcfce7' : '#fefce8',
                    color: inv.claimed ? '#166534' : '#854d0e',
                  }}>
                    {inv.claimed ? 'Claimed' : 'Pending'}
                  </span>
                </td>
                <td style={{ ...tdStyle, fontSize: 12, color: '#999' }}>
                  {new Date(inv.createdAt).toLocaleTimeString()}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <p style={{ fontSize: 12, color: '#999', marginTop: 16 }}>
        Auto-refreshes every 5 seconds. Data from Invite Service at {INVITE_SERVICE_URL}/invites
      </p>
    </div>
  )
}

function StatCard({ label, value, color }: { label: string; value: number; color?: string }) {
  return (
    <div style={{ padding: 16, border: '1px solid #e5e7eb', borderRadius: 8, minWidth: 120, textAlign: 'center' }}>
      <div style={{ fontSize: 28, fontWeight: 'bold', color: color || '#111' }}>{value}</div>
      <div style={{ fontSize: 13, color: '#999' }}>{label}</div>
    </div>
  )
}

const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse', border: '1px solid #e5e7eb', borderRadius: 8 }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '8px 10px', borderBottom: '2px solid #e5e7eb', fontSize: 12, color: '#999', background: '#fafafa' }
const tdStyle: React.CSSProperties = { padding: '8px 10px', borderBottom: '1px solid #f5f5f5', fontSize: 14 }
