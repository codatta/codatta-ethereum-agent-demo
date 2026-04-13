import { useState } from 'react'
import { useParams, Link, useNavigate } from 'react-router-dom'
import { useAgentDetail } from '../hooks/useAgentDetail'
import { THEME, styles } from '../lib/theme'
import { hexToDidUri, normalizeEndpoint } from '../config/env'

export function AgentDetail() {
  const { agentId } = useParams()
  const navigate = useNavigate()
  const { detail, loading } = useAgentDetail(agentId)
  const [showTechnical, setShowTechnical] = useState(false)

  if (loading) return <p>Loading...</p>
  if (!detail) return <p>Not found</p>

  const reg = detail.registrationFile
  const services = reg?.services || []

  return (
    <div>
      <span onClick={() => navigate(-1)} style={{ fontSize: 13, color: THEME.textSecondary, cursor: 'pointer' }}>&larr; Back</span>

      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', marginTop: 12 }}>
        <div>
          <h2 style={{ margin: '0 0 4px' }}>{reg?.name || `Agent ${agentId?.slice(0, 12)}...`}</h2>
          <p style={{ margin: '0 0 6px', ...styles.mono, fontSize: 12, color: THEME.textMuted, userSelect: 'all' }}>
            Agent ID: {detail.agentId.toString()}
          </p>
          <p style={{ margin: 0, fontSize: 14, color: THEME.textSecondary, lineHeight: 1.6 }}>{reg?.description || 'No description'}</p>
        </div>
        <div style={{ textAlign: 'center', flexShrink: 0, marginLeft: 24 }}>
          <div style={{ fontSize: 36, fontWeight: 'bold', color: detail.reputationScore >= 80 ? THEME.success : detail.reputationScore >= 50 ? THEME.accentOrange : THEME.textMuted }}>
            {detail.reputationScore || '—'}
          </div>
          <div style={{ fontSize: 12, color: THEME.textMuted }}>Reputation</div>
        </div>
      </div>

      {/* Status tags */}
      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {reg?.active && <span style={styles.badge(THEME.success)}>Active</span>}
        {services.some(s => s.name === 'MCP') && <span style={styles.badge(THEME.accentBlue)}>MCP</span>}
        {services.some(s => s.name === 'A2A') && <span style={styles.badge(THEME.accentBlue)}>A2A</span>}
        {reg?.x402Support && <span style={styles.badge(THEME.accentOrange)}>x402 Payment</span>}
        {reg?.supportedTrust?.map(t => <span key={t} style={styles.badge(THEME.textSecondary)}>{t}</span>)}
      </div>

      {/* Service Endpoints */}
      {services.length > 0 && (
        <section style={styles.section}>
          <h3>Service Endpoints</h3>
          <div style={{ display: 'grid', gap: 10 }}>
            {services.map((svc, i) => (
              <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                <span style={{ ...styles.badge(THEME.accentBlue), minWidth: 40, textAlign: 'center' }}>{svc.name}</span>
                <code style={{ ...styles.mono, fontSize: 12, color: THEME.textPrimary, flex: 1, wordBreak: 'break-all', userSelect: 'all' }}>
                  {normalizeEndpoint(svc.endpoint)}
                </code>
                {svc.version && <span style={{ fontSize: 11, color: THEME.textMuted }}>{svc.version}</span>}
                <button
                  onClick={() => navigator.clipboard.writeText(normalizeEndpoint(svc.endpoint))}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: THEME.accentBlue, padding: 0, flexShrink: 0 }}
                >
                  Copy
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Reputation & Feedback */}
      <section style={styles.section}>
        <h3>Reputation & Feedback</h3>
        {detail.feedbacks.length === 0 ? (
          <p style={{ color: THEME.textMuted, fontSize: 13 }}>No feedback yet.</p>
        ) : (
          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Client</th><th style={styles.th}>Score</th></tr>
            </thead>
            <tbody>
              {detail.feedbacks.map((fb, i) => (
                <tr key={i}>
                  <td style={{ ...styles.td, ...styles.mono }}>{fb.clientAddress.slice(0, 10)}...{fb.clientAddress.slice(-4)}</td>
                  <td style={styles.td}>
                    <span style={{ fontWeight: 'bold', color: fb.score >= 80 ? THEME.success : THEME.accentOrange }}>{fb.score}</span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Validation Records */}
      {detail.validations.length > 0 && (
        <section style={styles.section}>
          <h3>Validation Records</h3>
          <table style={styles.table}>
            <thead>
              <tr><th style={styles.th}>Validator</th><th style={styles.th}>Score</th><th style={styles.th}>Status</th></tr>
            </thead>
            <tbody>
              {detail.validations.map((val, i) => (
                <tr key={i}>
                  <td style={{ ...styles.td, ...styles.mono }}>{val.validatorAddress.slice(0, 10)}...</td>
                  <td style={styles.td}>{val.response != null ? val.response : '—'}</td>
                  <td style={styles.td}>
                    <span style={{ fontSize: 12, color: val.response != null ? THEME.success : THEME.accentOrange }}>
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
        <section style={styles.section}>
          <h3>Codatta DID</h3>
          <Link to={`/did/${detail.didIdentifier.toString(16)}`} style={{ ...styles.mono, fontSize: 13 }}>
            {hexToDidUri(detail.didIdentifier.toString(16))}
          </Link>
        </section>
      )}

      {/* Technical Details (collapsed) */}
      <section style={{ ...styles.section, background: THEME.canvas }}>
        <div
          onClick={() => setShowTechnical(!showTechnical)}
          style={{ cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
        >
          <h3 style={{ margin: 0 }}>Technical Details</h3>
          <span style={{ color: THEME.textMuted, fontSize: 13 }}>{showTechnical ? '▲ Hide' : '▼ Show'}</span>
        </div>
        {showTechnical && (
          <div style={{ marginTop: 12 }}>
            <table style={styles.table}>
              <tbody>
                <Row label="Agent ID" value={detail.agentId.toString()} mono />
                <Row label="Owner" value={detail.owner} mono />
                <Row label="Type" value={reg?.type || 'N/A'} />
              </tbody>
            </table>
            {services.length > 0 && (
              <>
                <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>All Service Endpoints</h4>
                <table style={styles.table}>
                  <thead><tr><th style={styles.th}>Name</th><th style={styles.th}>Endpoint</th><th style={styles.th}>Version</th></tr></thead>
                  <tbody>
                    {services.map((svc, i) => (
                      <tr key={i}>
                        <td style={styles.td}>{svc.name}</td>
                        <td style={{ ...styles.td, ...styles.mono, fontSize: 11, wordBreak: 'break-all' }}>{normalizeEndpoint(svc.endpoint)}</td>
                        <td style={styles.td}>{svc.version || '—'}</td>
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

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={{ ...styles.td, fontWeight: 'bold', width: 100 }}>{label}</td>
      <td style={{ ...styles.td, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 11 : 14, wordBreak: 'break-all' }}>{value}</td>
    </tr>
  )
}
