import { useParams, Link } from 'react-router-dom'
import { useDIDDocument } from '../hooks/useDIDDocument'

export function DIDDocumentPage() {
  const { identifier } = useParams()
  const { doc, loading } = useDIDDocument(identifier)

  if (loading) return <p>Loading DID Document...</p>
  if (!doc) return <p>DID not found</p>

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: '#666' }}>&larr; Back</Link>
      <h2>did:codatta:{doc.idHex}</h2>

      <section style={sectionStyle}>
        <h3>Identity</h3>
        <table style={tableStyle}>
          <tbody>
            <tr><td style={labelStyle}>DID</td><td style={valStyle}>did:codatta:{doc.idHex}</td></tr>
            <tr><td style={labelStyle}>Owner</td><td style={valStyle}>{doc.owner}</td></tr>
            {doc.controllers.length > 0 && (
              <tr><td style={labelStyle}>Controllers</td><td style={valStyle}>{doc.controllers.map(c => c.toString(16)).join(', ')}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {doc.kvAttributes.length > 0 && (
        <section style={sectionStyle}>
          <h3>Key-Value Attributes</h3>
          <table style={tableStyle}>
            <thead><tr><th style={thStyle}>Key</th><th style={thStyle}>Value</th></tr></thead>
            <tbody>
              {doc.kvAttributes.map((attr, i) => (
                <tr key={i}>
                  <td style={labelStyle}>{attr.name}</td>
                  <td style={{ ...valStyle, wordBreak: 'break-all' }}>{attr.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {doc.arrayAttributes.filter(a => a.items.length > 0).map((attr, i) => (
        <section key={i} style={sectionStyle}>
          <h3>{attr.name} ({attr.items.length})</h3>
          {attr.items.map((item, j) => (
            <div key={j} style={{ marginBottom: 8, padding: 10, background: item.revoked ? '#fef2f2' : '#f9fafb', borderRadius: 6, fontSize: 13 }}>
              {item.revoked && <span style={{ color: '#dc2626', fontWeight: 'bold' }}>[revoked] </span>}
              {item.isJson ? (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontFamily: 'monospace', fontSize: 12 }}>
                  {JSON.stringify(item.parsed, null, 2)}
                </pre>
              ) : (
                <span style={{ fontFamily: 'monospace' }}>{item.value}</span>
              )}
            </div>
          ))}
        </section>
      ))}

      {doc.arrayAttributes.every(a => a.items.length === 0) && doc.kvAttributes.length === 0 && (
        <p style={{ color: '#999', marginTop: 20 }}>No attributes set.</p>
      )}
    </div>
  )
}

const sectionStyle: React.CSSProperties = { marginTop: 24, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #eee', fontSize: 12, color: '#999' }
const labelStyle: React.CSSProperties = { padding: '6px 10px', fontWeight: 'bold', width: 140, borderBottom: '1px solid #f5f5f5' }
const valStyle: React.CSSProperties = { padding: '6px 10px', fontFamily: 'monospace', fontSize: 12, borderBottom: '1px solid #f5f5f5' }
