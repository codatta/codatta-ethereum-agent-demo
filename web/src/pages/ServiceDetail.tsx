import { useParams, Link } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'
import { usePublicClient } from 'wagmi'
import { useEffect, useState } from 'react'
import { parseAbi } from 'viem'
import { addresses, reputationRegistryAbi } from '../config/contracts'

const SERVICE_INFO: Record<string, { name: string; description: string }> = {
  annotation: {
    name: 'Data Annotation',
    description: 'Browse annotation service providers. Agents are ranked by reputation score.',
  },
}

interface AgentWithScore {
  agentId: bigint
  owner: string
  name: string
  description: string
  reputationScore: number
  services: Array<{ name: string; endpoint: string }>
  x402Support: boolean
}

export function ServiceDetail() {
  const { type } = useParams()
  const { agents, loading: agentsLoading } = useAgentList()
  const client = usePublicClient()
  const [rankedAgents, setRankedAgents] = useState<AgentWithScore[]>([])
  const [loading, setLoading] = useState(true)

  const info = SERVICE_INFO[type || '']

  useEffect(() => {
    if (!client || agentsLoading) return
    let cancelled = false

    async function fetchScores() {
      setLoading(true)
      const repAbi = parseAbi(reputationRegistryAbi as unknown as string[])

      // Filter agents matching this service type
      const matched = agents.filter(a => {
        const desc = (a.description || '').toLowerCase()
        if (type === 'annotation') {
          return desc.includes('annotation') || desc.includes('label') || desc.includes('detection')
        }
        return false
      })

      const withScores: AgentWithScore[] = []
      for (const agent of matched) {
        let score = 0
        try {
          const s = await client!.readContract({
            address: addresses.reputationRegistry, abi: repAbi,
            functionName: 'getScore', args: [agent.agentId],
          }) as bigint
          score = Number(s)
        } catch {}

        withScores.push({
          agentId: agent.agentId,
          owner: agent.owner,
          name: agent.name,
          description: agent.description,
          reputationScore: score,
          services: agent.registrationFile?.services || [],
          x402Support: agent.registrationFile?.x402Support || false,
        })
      }

      // Sort by reputation descending
      withScores.sort((a, b) => b.reputationScore - a.reputationScore)

      if (!cancelled) {
        setRankedAgents(withScores)
        setLoading(false)
      }
    }

    fetchScores()
    return () => { cancelled = true }
  }, [client, agents, agentsLoading, type])

  if (!info) {
    return (
      <div>
        <Link to="/" style={{ fontSize: 13, color: '#666' }}>&larr; Back to Services</Link>
        <h2>Service not found</h2>
      </div>
    )
  }

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: '#666' }}>&larr; Back to Services</Link>
      <h2>{info.name}</h2>
      <p style={{ color: '#666', marginBottom: 20 }}>{info.description}</p>

      {loading ? (
        <p>Loading providers...</p>
      ) : rankedAgents.length === 0 ? (
        <div style={{ padding: 24, background: '#fafafa', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ color: '#999' }}>No providers available for this service.</p>
          <p style={{ color: '#999', fontSize: 13 }}>Run <code>npm run start:provider</code> to register one.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {rankedAgents.map((agent, rank) => {
            const hasMCP = agent.services.some(s => s.name === 'MCP')
            const hasA2A = agent.services.some(s => s.name === 'A2A')

            return (
              <Link
                key={agent.agentId.toString()}
                to={`/agent/${agent.agentId.toString()}`}
                style={{ textDecoration: 'none', color: 'inherit' }}
              >
                <div style={cardStyle}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                    {/* Rank */}
                    <div style={{ width: 32, height: 32, borderRadius: '50%', background: rank === 0 ? '#fef3c7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 'bold', color: rank === 0 ? '#92400e' : '#6b7280', flexShrink: 0 }}>
                      {rank + 1}
                    </div>

                    {/* Info */}
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                        <strong>{agent.name}</strong>
                        <div style={{ display: 'flex', gap: 4 }}>
                          {hasMCP && <Tag>MCP</Tag>}
                          {hasA2A && <Tag>A2A</Tag>}
                          {agent.x402Support && <Tag>x402</Tag>}
                        </div>
                      </div>
                      <p style={{ margin: '4px 0 0', fontSize: 13, color: '#666' }}>
                        {agent.description.slice(0, 100)}{agent.description.length > 100 ? '...' : ''}
                      </p>
                    </div>

                    {/* Score */}
                    <div style={{ textAlign: 'center', flexShrink: 0 }}>
                      <div style={{ fontSize: 24, fontWeight: 'bold', color: agent.reputationScore >= 80 ? '#16a34a' : agent.reputationScore >= 50 ? '#ca8a04' : '#9ca3af' }}>
                        {agent.reputationScore || '—'}
                      </div>
                      <div style={{ fontSize: 11, color: '#999' }}>Reputation</div>
                    </div>
                  </div>
                </div>
              </Link>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 24, padding: 16, background: '#f5f3ff', borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong>How to use?</strong> Check the <Link to="/guide">integration guide</Link> for step-by-step instructions.
        </p>
      </div>
    </div>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#eef2ff', color: '#4f46e5' }}>
      {children}
    </span>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: 'white', cursor: 'pointer',
}
