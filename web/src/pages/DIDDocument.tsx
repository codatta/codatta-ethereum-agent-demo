import { useParams, Link } from 'react-router-dom'
import { useDIDDocument } from '../hooks/useDIDDocument'
import { THEME, styles } from '../lib/theme'
import { hexToDidUri } from '../config/env'

export function DIDDocumentPage() {
  const { identifier } = useParams()
  const { doc, loading } = useDIDDocument(identifier)

  if (loading) return <p>Loading DID Document...</p>
  if (!doc) return <p>DID not found</p>

  return (
    <div>
      <Link to="/agents" style={{ fontSize: 13, color: THEME.textSecondary }}>&larr; Back</Link>
      <h2>{hexToDidUri(doc.idHex)}</h2>

      <section style={styles.section}>
        <h3>Identity</h3>
        <table style={styles.table}>
          <tbody>
            <tr><td style={{ ...styles.td, fontWeight: 'bold', width: 140 }}>DID</td><td style={{ ...styles.td, ...styles.mono }}>{hexToDidUri(doc.idHex)}</td></tr>
            <tr><td style={{ ...styles.td, fontWeight: 'bold', width: 140 }}>Owner</td><td style={{ ...styles.td, ...styles.mono }}>{doc.owner}</td></tr>
            {doc.controllers.length > 0 && (
              <tr><td style={{ ...styles.td, fontWeight: 'bold', width: 140 }}>Controllers</td><td style={{ ...styles.td, ...styles.mono }}>{doc.controllers.map(c => c.toString(16)).join(', ')}</td></tr>
            )}
          </tbody>
        </table>
      </section>

      {doc.kvAttributes.length > 0 && (
        <section style={styles.section}>
          <h3>Key-Value Attributes</h3>
          <table style={styles.table}>
            <thead><tr><th style={styles.th}>Key</th><th style={styles.th}>Value</th></tr></thead>
            <tbody>
              {doc.kvAttributes.map((attr, i) => (
                <tr key={i}>
                  <td style={{ ...styles.td, fontWeight: 'bold', width: 140 }}>{attr.name}</td>
                  <td style={{ ...styles.td, ...styles.mono, wordBreak: 'break-all' }}>{attr.value}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}

      {doc.arrayAttributes.filter(a => a.items.length > 0).map((attr, i) => (
        <section key={i} style={styles.section}>
          <h3>{attr.name} ({attr.items.length})</h3>
          {attr.items.map((item, j) => (
            <div key={j} style={{ marginBottom: 8, padding: 10, background: item.revoked ? 'rgba(239,68,68,0.04)' : THEME.canvas, borderRadius: THEME.radiusInput, fontSize: 13 }}>
              {item.revoked && <span style={{ color: THEME.danger, fontWeight: 'bold' }}>[revoked] </span>}
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
        <p style={{ color: THEME.textMuted, marginTop: 20 }}>No attributes set.</p>
      )}
    </div>
  )
}
