import { Link } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'

export function AgentList() {
  const { agents, loading, error } = useAgentList()

  if (loading) return <p>Loading agents...</p>
  if (error) return <p style={{ color: 'red' }}>Error: {error}</p>

  return (
    <div>
      <h2>Registered Agents ({agents.length})</h2>
      {agents.length === 0 ? (
        <p style={{ color: '#999' }}>No agents registered yet. Run the Provider to register one.</p>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {agents.map((agent) => (
            <Link
              key={agent.agentId.toString()}
              to={`/agent/${agent.agentId.toString()}`}
              style={{ textDecoration: 'none', color: 'inherit' }}
            >
              <div style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px 0' }}>{agent.name}</h3>
                    <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
                      {agent.description.slice(0, 120)}{agent.description.length > 120 ? '...' : ''}
                    </p>
                  </div>
                  {agent.registrationFile?.active && (
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>
                      Active
                    </span>
                  )}
                </div>
                <div style={{ marginTop: 10, fontSize: 12, color: '#999', fontFamily: 'monospace' }}>
                  <span>ID: {agent.agentId.toString().slice(0, 20)}...</span>
                  <span style={{ marginLeft: 16 }}>Owner: {agent.owner.slice(0, 10)}...</span>
                  {agent.registrationFile?.x402Support && (
                    <span style={{ marginLeft: 16, color: '#7c3aed' }}>x402</span>
                  )}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 16,
  background: 'white', cursor: 'pointer', transition: 'box-shadow 0.2s',
}
