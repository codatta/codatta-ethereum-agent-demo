import { useState } from 'react'
import { useParams, Link } from 'react-router-dom'
import { useAgentDetail } from '../hooks/useAgentDetail'

export function AgentDetail() {
  const { agentId } = useParams()
  const { detail, loading } = useAgentDetail(agentId)
  const [showTechnical, setShowTechnical] = useState(false)

  if (loading) return <p>Loading agent...</p>
  if (!detail) return <p>Agent not found</p>

  const reg = detail.registrationFile
  const services = reg?.services || []
  const hasMCP = services.some(s => s.name === 'MCP')
  const hasA2A = services.some(s => s.name === 'A2A')
  const mcpEndpoint = services.find(s => s.name === 'MCP')?.endpoint
  const a2aEndpoint = services.find(s => s.name === 'A2A')?.endpoint

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: '#666' }}>&larr; Back</Link>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginTop: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{reg?.name || `Agent ${agentId?.slice(0, 12)}...`}</h2>
          <p style={{ margin: 0, fontSize: 14, color: '#666', lineHeight: 1.6 }}>{reg?.description || 'No description'}</p>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 24 }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: detail.reputationScore >= 80 ? '#16a34a' : detail.reputationScore >= 50 ? '#ca8a04' : '#9ca3af' }}>
            {detail.reputationScore || '—'}
          </div>
          <div style={{ fontSize: 12, color: '#999' }}>Reputation</div>
        </div>
      </div>

      {/* Status tags */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {reg?.active && <Tag color="#166534" bg="#dcfce7">Active</Tag>}
        {hasMCP && <Tag color="#4f46e5" bg="#eef2ff">MCP</Tag>}
        {hasA2A && <Tag color="#0891b2" bg="#ecfeff">A2A</Tag>}
        {reg?.x402Support && <Tag color="#d97706" bg="#fef3c7">x402 Payment</Tag>}
        {reg?.supportedTrust?.map(t => <Tag key={t} color="#6b7280" bg="#f3f4f6">{t}</Tag>)}
      </div>

      {/* How to connect */}
      <section style={sectionStyle}>
        <h3>How to Connect</h3>
        {hasMCP && (
          <div style={{ marginBottom: 12 }}>
            <strong style={{ fontSize: 13 }}>MCP (Recommended)</strong>
            <p style={{ margin: '4px 0', fontSize: 13, color: '#666' }}>
              Connect via MCP to discover tools and invoke annotation directly.
            </p>
            <code style={codeStyle}>{mcpEndpoint}</code>
          </div>
        )}
        {hasA2A && (
          <div>
            <strong style={{ fontSize: 13 }}>A2A (Consultation)</strong>
            <p style={{ margin: '4px 0', fontSize: 13, color: '#666' }}>
              Chat with the agent to ask about capabilities, pricing, and get an invite code.
            </p>
            <code style={codeStyle}>{a2aEndpoint}</code>
          </div>
        )}
        <p style={{ margin: '12px 0 0', fontSize: 13 }}>
          <Link to="/guide">See integration guide →</Link>
        </p>
      </section>

      {/* Reputation & Feedback */}
      <section style={sectionStyle}>
        <h3>Reputation & Feedback</h3>
        {detail.feedbacks.length === 0 ? (
          <p style={{ color: '#999', fontSize: 13 }}>No feedback yet.</p>
        ) : (
          <table style={tableStyle}>
            <thead>
              <tr><th style={thStyle}>Client</th><th style={thStyle}>Score</th></tr>
            </thead>
            <tbody>
              {detail.feedbacks.map((fb, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{fb.clientAddress.slice(0, 10)}...{fb.clientAddress.slice(-4)}</td>
                  <td style={tdStyle}>
                    <span style={{ fontWeight: 'bold', color: fb.score >= 80 ? '#16a34a' : '#ca8a04' }}>{fb.score}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Validation Records */}
      {detail.validations.length > 0 && (
        <section style={sectionStyle}>
          <h3>Validation Records</h3>
          <table style={tableStyle}>
            <thead>
              <tr><th style={thStyle}>Validator</th><th style={thStyle}>Score</th><th style={thStyle}>Status</th></tr>
            </thead>
            <tbody>
              {detail.validations.map((val, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{val.validatorAddress.slice(0, 10)}...</td>
                  <td style={tdStyle}>{val.response != null ? val.response : '—'}</td>
                  <td style={tdStyle}>
                    <span style={{ fontSize: 12, color: val.response != null ? '#16a34a' : '#ca8a04' }}>
                      {val.response != null ? 'Verified' : 'Pending'}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* Codatta DID */}
      {detail.didIdentifier && (
        <section style={sectionStyle}>
          <h3>Codatta DID</h3>
          <Link to={`/did/${detail.didIdentifier.toString(16)}`} style={{ fontFamily: 'monospace', fontSize: 13 }}>
            did:codatta:{detail.didIdentifier.toString(16)}
          </Link>
        </section>
      )}

      {/* Technical Details (collapsed) */}
      <section style={{ ...sectionStyle, background: '#fafafa' }}>
        <div
          onClick={() => setShowTechnical(!showTechnical)}
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <h3 style={{ margin: 0 }}>Technical Details</h3>
          <span style={{ color: '#999', fontSize: 13 }}>{showTechnical ? '▲ Hide' : '▼ Show'}</span>
        </div>
        {showTechnical && (
          <div style={{ marginTop: 12 }}>
            <table style={tableStyle}>
              <tbody>
                <Row label="Agent ID" value={detail.agentId.toString()} mono />
                <Row label="Owner" value={detail.owner} mono />
                <Row label="Type" value={reg?.type || 'N/A'} />
              </tbody>
            </table>
            {services.length > 0 && (
              <>
                <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>All Service Endpoints</h4>
                <table style={tableStyle}>
                  <thead><tr><th style={thStyle}>Name</th><th style={thStyle}>Endpoint</th><th style={thStyle}>Version</th></tr></thead>
                  <tbody>
                    {services.map((svc, i) => (
                      <tr key={i}>
                        <td style={tdStyle}>{svc.name}</td>
                        <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>{svc.endpoint}</td>
                        <td style={tdStyle}>{svc.version || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </div>
        )}
      </section>
    </div>
  )
}

function Tag({ color, bg, children }: { color: string; bg: string; children: React.ReactNode }) {
  return <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 12, color, background: bg }}>{children}</span>
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={{ ...tdStyle, fontWeight: 'bold', width: 100 }}>{label}</td>
      <td style={{ ...tdStyle, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 14, wordBreak: 'break-all' }}>{value}</td>
    </tr>
  )
}

const sectionStyle: React.CSSProperties = { marginTop: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #eee', fontSize: 12, color: '#999' }
const tdStyle: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #f5f5f5', fontSize: 14 }
const codeStyle: React.CSSProperties = { display: 'block', padding: '8px 12px', background: '#f3f4f6', borderRadius: 4, fontSize: 12, fontFamily: 'monospace', wordBreak: 'break-all' }
