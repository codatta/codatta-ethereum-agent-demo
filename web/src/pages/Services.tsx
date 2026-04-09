import { Link } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'

export function Services() {
  const { agents, loading, error } = useAgentList()

  if (loading) return <p>Loading services...</p>
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>

  return (
    <div>
      <h2>Data Annotation Services</h2>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Browse available annotation agents. Each agent provides MCP tools for image labeling, segmentation, and classification.
      </p>

      {agents.length === 0 ? (
        <div style={{ padding: 24, background: '#fafafa', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ color: '#999', margin: 0 }}>No agents registered yet.</p>
          <p style={{ color: '#999', fontSize: 13 }}>
            Run <code>npm run start:provider</code> in the agent directory to register one.
          </p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {agents.map((agent) => {
            const reg = agent.registrationFile
            const services = reg?.services || []
            const hasMCP = services.some(s => s.name === 'MCP')
            const hasA2A = services.some(s => s.name === 'A2A')
            const hasDID = services.some(s => s.name === 'DID')

            return (
              <Link
                key={agent.agentId.toString()}
                to={`/agent/${agent.agentId.toString()}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={cardStyle}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                    <div style={{ flex: 1 }}>
                      <h3 style={{ margin: '0 0 6px 0' }}>{agent.name}</h3>
                      <p style={{ margin: 0, fontSize: 13, color: '#666', lineHeight: 1.5 }}>
                        {agent.description.slice(0, 150)}{agent.description.length > 150 ? '...' : ''}
                      </p>
                    </div>
                    {reg?.active && (
                      <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 12, fontSize: 12, flexShrink: 0, marginLeft: 12 }}>
                        Active
                      </span>
                    )}
                  </div>

                  {/* Protocols & Features */}
                  <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
                    {hasMCP && <Tag color="#7c3aed">MCP</Tag>}
                    {hasA2A && <Tag color="#0891b2">A2A</Tag>}
                    {hasDID && <Tag color="#059669">DID</Tag>}
                    {reg?.x402Support && <Tag color="#d97706">x402</Tag>}
                    {reg?.supportedTrust?.map(t => <Tag key={t} color="#6b7280">{t}</Tag>)}
                  </div>

                  {/* Owner */}
                  <div style={{ marginTop: 10, fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                    Owner: {agent.owner.slice(0, 10)}...{agent.owner.slice(-4)}
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 24, padding: 16, background: '#f5f3ff', borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong>New to Codatta?</strong> Check the <Link to="/guide">Guide</Link> to learn how to use these services via MCP and A2A.
        </p>
      </div>
    </div>
  )
}

function Tag({ color, children }: { color: string; children: React.ReactNode }) {
  return (
    <span style={{ padding: '2px 8px', borderRadius: 12, fontSize: 11, fontWeight: 600, color, background: `${color}15`, border: `1px solid ${color}30` }}>
      {children}
    </span>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 16,
  background: 'white', cursor: 'pointer', transition: 'box-shadow 0.2s',
}
