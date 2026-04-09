import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'
import { usePublicClient } from 'wagmi'
import { useEffect, useState } from 'react'
import { parseAbi } from 'viem'
import { addresses, reputationRegistryAbi } from '../config/contracts'

const SERVICE_INFO: Record<string, { name: string; description: string }> = {
  annotation: {
    name: 'Data Annotation',
    description: 'Image labeling, object detection, semantic segmentation, and text classification.',
    providersHint: 'Providers are ranked by reputation score.',
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

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'providers'

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: '#666' }}>&larr; Back to Services</Link>
      <h2>{info.name}</h2>
      <p style={{ color: '#666', marginBottom: 16 }}>{info.description}</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: '2px solid #e5e7eb', marginBottom: 20 }}>
        <TabButton label="Providers" active={activeTab === 'providers'} onClick={() => setSearchParams({ tab: 'providers' })} />
        <TabButton label="Integration Guide" active={activeTab === 'guide'} onClick={() => setSearchParams({ tab: 'guide' })} />
      </div>

      {/* Providers Tab */}
      {activeTab === 'providers' && (
        <>
          <p style={{ color: '#999', fontSize: 13, marginBottom: 16 }}>{info.providersHint}</p>
          {loading ? (
            <p>Loading providers...</p>
          ) : rankedAgents.length === 0 ? (
            <div style={{ padding: 24, background: '#fafafa', borderRadius: 8, textAlign: 'center' }}>
              <p style={{ color: '#999' }}>No providers available for this service.</p>
              <p style={{ color: '#999', fontSize: 13 }}>No providers have registered for this service yet.</p>
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
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: rank === 0 ? '#fef3c7' : '#f3f4f6', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 'bold', color: rank === 0 ? '#92400e' : '#6b7280', flexShrink: 0 }}>
                          {rank + 1}
                        </div>
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
        </>
      )}

      {/* Guide Tab */}
      {activeTab === 'guide' && type === 'annotation' && <AnnotationGuide />}
    </div>
  )
}

function TabButton({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '8px 16px', border: 'none', background: 'none', cursor: 'pointer',
      fontSize: 14, fontWeight: active ? 600 : 400,
      color: active ? '#4f46e5' : '#6b7280',
      borderBottom: active ? '2px solid #4f46e5' : '2px solid transparent',
      marginBottom: -2,
    }}>
      {label}
    </button>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: '#eef2ff', color: '#4f46e5' }}>
      {children}
    </span>
  )
}

function AnnotationGuide() {
  return (
    <div style={{ marginTop: 32 }}>
      <h3>Integration Guide — Data Annotation</h3>
      <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
        Two ways to use this service: quick MCP call, or full flow with A2A consultation and free quota.
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        <GuideSection title="Quick Start (MCP)">
          <p>Connect to the agent's MCP endpoint and call the <code>annotate</code> tool directly:</p>
          <Code>{`const client = new Client({ name: "my-client", version: "1.0.0" });
await client.connect(new StreamableHTTPClientTransport(new URL(mcpEndpoint)));

// Discover tools
const { tools } = await client.listTools();
// → annotate, get_task_status, claim_invite

// Submit annotation task (async)
const result = await client.callTool({
  name: "annotate",
  arguments: {
    images: ["https://example.com/img-001.jpg", "https://example.com/img-002.jpg"],
    task: "object-detection"
  }
});
// → { taskId: "task-xxx", status: "working" }

// Poll for results
const status = await client.callTool({
  name: "get_task_status",
  arguments: { taskId: "task-xxx" }
});
// → { status: "completed", annotations: [...] }`}</Code>
        </GuideSection>

        <GuideSection title="Full Flow (A2A + Free Quota)">
          <ol style={{ paddingLeft: 20, fontSize: 13, lineHeight: 2 }}>
            <li><strong>A2A Consultation</strong> — Chat with the agent to learn about capabilities and pricing</li>
            <li><strong>Get Invite Code</strong> — Request an invite code during consultation</li>
            <li><strong>Register Codatta DID</strong> — Free on-chain identity registration</li>
            <li><strong>Claim Invite</strong> — Call <code>claim_invite</code> MCP tool to get 10 free credits</li>
            <li><strong>Annotate</strong> — Call <code>annotate</code> with your DID to use free quota</li>
            <li><strong>Feedback</strong> — Submit reputation score to ERC-8004</li>
          </ol>
        </GuideSection>

      </div>
    </div>
  )
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }}>
      <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>{title}</h4>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre style={{
      background: '#1e1e1e', color: '#d4d4d4', padding: 12, borderRadius: 6,
      fontSize: 12, lineHeight: 1.5, overflow: 'auto', margin: '8px 0',
    }}>{children}</pre>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: 'white', cursor: 'pointer',
}
