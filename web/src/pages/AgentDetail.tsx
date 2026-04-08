import { useParams, Link } from 'react-router-dom'
import { useAgentDetail } from '../hooks/useAgentDetail'

export function AgentDetail() {
  const { agentId } = useParams()
  const { detail, loading } = useAgentDetail(agentId)

  if (loading) return <p>Loading agent...</p>
  if (!detail) return <p>Agent not found</p>

  const reg = detail.registrationFile

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: '#666' }}>&larr; Back to list</Link>
      <h2>{reg?.name || `Agent ${agentId?.slice(0, 12)}...`}</h2>

      {/* Basic Info */}
      <section style={sectionStyle}>
        <h3>Registration File</h3>
        <table style={tableStyle}>
          <tbody>
            <Row label="Agent ID" value={detail.agentId.toString()} mono />
            <Row label="Owner" value={detail.owner} mono />
            <Row label="Description" value={reg?.description || 'N/A'} />
            <Row label="Active" value={reg?.active ? 'Yes' : 'No'} />
            <Row label="x402 Support" value={reg?.x402Support ? 'Yes' : 'No'} />
            <Row label="Trust" value={reg?.supportedTrust?.join(', ') || 'N/A'} />
          </tbody>
        </table>
      </section>

      {/* Services */}
      {reg?.services && reg.services.length > 0 && (
        <section style={sectionStyle}>
          <h3>Services</h3>
          <table style={tableStyle}>
            <thead>
              <tr><th style={thStyle}>Name</th><th style={thStyle}>Endpoint</th><th style={thStyle}>Version</th></tr>
            </thead>
            <tbody>
              {reg.services.map((svc, i) => (
                <tr key={i}>
                  <td style={tdStyle}>{svc.name}</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{svc.endpoint}</td>
                  <td style={tdStyle}>{svc.version || '-'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {/* DID Link */}
      {detail.didIdentifier && (
        <section style={sectionStyle}>
          <h3>Codatta DID</h3>
          <p>
            <Link to={`/did/${detail.didIdentifier.toString(16)}`} style={{ fontFamily: 'monospace' }}>
              did:codatta:{detail.didIdentifier.toString(16)}
            </Link>
          </p>
        </section>
      )}

      {/* Reputation */}
      <section style={sectionStyle}>
        <h3>Reputation</h3>
        <div style={{ fontSize: 32, fontWeight: 'bold', color: detail.reputationScore >= 80 ? '#16a34a' : detail.reputationScore >= 50 ? '#ca8a04' : '#dc2626' }}>
          {detail.reputationScore}
        </div>
        {detail.feedbacks.length > 0 && (
          <table style={{ ...tableStyle, marginTop: 10 }}>
            <thead>
              <tr><th style={thStyle}>From</th><th style={thStyle}>Score</th></tr>
            </thead>
            <tbody>
              {detail.feedbacks.map((fb, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{fb.clientAddress.slice(0, 10)}...</td>
                  <td style={tdStyle}>{fb.score}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* Validation */}
      {detail.validations.length > 0 && (
        <section style={sectionStyle}>
          <h3>Validation Records</h3>
          <table style={tableStyle}>
            <thead>
              <tr><th style={thStyle}>Request Hash</th><th style={thStyle}>Validator</th><th style={thStyle}>Response</th></tr>
            </thead>
            <tbody>
              {detail.validations.map((val, i) => (
                <tr key={i}>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{val.requestHash.slice(0, 18)}...</td>
                  <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{val.validatorAddress.slice(0, 10)}...</td>
                  <td style={tdStyle}>{val.response != null ? `Score: ${val.response}` : 'Pending'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <tr>
      <td style={{ ...tdStyle, fontWeight: 'bold', width: 140 }}>{label}</td>
      <td style={{ ...tdStyle, fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 12 : 14, wordBreak: 'break-all' }}>{value}</td>
    </tr>
  )
}

const sectionStyle: React.CSSProperties = { marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #eee', fontSize: 12, color: '#999' }
const tdStyle: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #f5f5f5', fontSize: 14 }
