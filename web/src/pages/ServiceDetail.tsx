import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'
import { useHiddenAgents } from '../hooks/useHiddenAgents'
import { usePublicClient } from 'wagmi'
import { useEffect, useState } from 'react'
import { parseAbi } from 'viem'
import { addresses, reputationRegistryAbi } from '../config/contracts'
import { THEME, styles } from '../lib/theme'

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
  const { hidden } = useHiddenAgents()
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

      // Filter agents matching this service type, exclude hidden
      const matched = agents.filter(a => {
        if (hidden.has(a.agentId.toString())) return false
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
        <Link to="/" style={{ fontSize: 13, color: THEME.textSecondary }}>&larr; Back to Services</Link>
        <h2>Service not found</h2>
      </div>
    )
  }

  const [searchParams, setSearchParams] = useSearchParams()
  const activeTab = searchParams.get('tab') || 'providers'

  return (
    <div>
      <Link to="/" style={{ fontSize: 13, color: THEME.textSecondary }}>&larr; Back to Services</Link>
      <h2>{info.name}</h2>
      <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>{info.description}</p>

      {/* Tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${THEME.canvas}`, marginBottom: 20 }}>
        <TabButton label="Providers" active={activeTab === 'providers'} onClick={() => setSearchParams({ tab: 'providers' })} />
        <TabButton label="Try it" active={activeTab === 'tryit'} onClick={() => setSearchParams({ tab: 'tryit' })} />
        <TabButton label="Get Started" active={activeTab === 'guide'} onClick={() => setSearchParams({ tab: 'guide' })} />
      </div>

      {/* Providers Tab */}
      {activeTab === 'providers' && (
        <>
          <p style={{ color: THEME.textMuted, fontSize: 13, marginBottom: 16 }}>{info.providersHint}</p>
          {loading ? (
            <p>Loading providers...</p>
          ) : rankedAgents.length === 0 ? (
            <div style={{ ...styles.card, textAlign: 'center' }}>
              <p style={{ color: THEME.textMuted }}>No providers available for this service.</p>
              <p style={{ color: THEME.textMuted, fontSize: 13 }}>No providers have registered for this service yet.</p>
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
                    <div style={styles.cardHover}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
                        <div style={{ width: 32, height: 32, borderRadius: '50%', background: rank === 0 ? THEME.accentOrangeLight : THEME.canvas, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14, fontWeight: 'bold', color: rank === 0 ? THEME.accentOrange : THEME.textSecondary, flexShrink: 0 }}>
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
                          <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>
                            {agent.description.slice(0, 100)}{agent.description.length > 100 ? '...' : ''}
                          </p>
                        </div>
                        <div style={{ textAlign: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: 24, fontWeight: 'bold', color: agent.reputationScore >= 80 ? THEME.success : agent.reputationScore >= 50 ? THEME.accentOrange : THEME.textMuted }}>
                            {agent.reputationScore || '—'}
                          </div>
                          <div style={{ fontSize: 11, color: THEME.textMuted }}>Reputation</div>
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
      {/* Try it Tab */}
      {activeTab === 'tryit' && type === 'annotation' && <AnnotationTryIt agents={rankedAgents} />}

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
      color: active ? THEME.accentBlue : THEME.textSecondary,
      borderBottom: active ? `2px solid ${THEME.accentBlue}` : '2px solid transparent',
      marginBottom: -2,
    }}>
      {label}
    </button>
  )
}

function Tag({ children }: { children: string }) {
  return (
    <span style={{ padding: '1px 6px', borderRadius: 4, fontSize: 10, fontWeight: 600, background: THEME.accentBlueLight, color: THEME.accentBlue }}>
      {children}
    </span>
  )
}

function AnnotationGuide() {
  return (
    <div style={{ marginTop: 32 }}>
      <h3>Integration Guide — Data Annotation</h3>
      <p style={{ color: THEME.textSecondary, fontSize: 13, marginBottom: 16 }}>
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
            <li><strong>Annotate</strong> — Call <code>annotate</code> MCP tool</li>
            <li><strong>Feedback</strong> — Submit reputation score to ERC-8004</li>
          </ol>
        </GuideSection>

        <GuideSection title="Download Agent Script">
          <p>
            For Agent-to-Agent integration, download and run the client script.
            It walks through the complete flow: A2A consultation, DID registration, MCP annotation, and reputation feedback.
          </p>
          <Code>{`# Clone the repository
git clone https://github.com/codatta/codatta-ethereum-agent-demo.git
cd codatta-ethereum-agent-demo/agent

# Install dependencies
npm install

# Configure (update .env with contract addresses)
cp .env.example .env
./sync-env.sh

# Run the client agent
npm run start:client`}</Code>
        </GuideSection>

      </div>
    </div>
  )
}

function AnnotationTryIt({ agents }: { agents: AgentWithScore[] }) {
  const [imageUrls, setImageUrls] = useState('https://example.com/street-001.jpg\nhttps://example.com/street-002.jpg')
  const [task, setTask] = useState('object-detection')
  const [status, setStatus] = useState<'idle' | 'connecting' | 'submitting' | 'polling' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [logs, setLogs] = useState<string[]>([])

  const topAgent = agents[0]
  const mcpEndpoint = topAgent?.services.find(s => s.name === 'MCP')?.endpoint

  function addLog(msg: string) {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  async function handleRun() {
    if (!mcpEndpoint) { setErrorMsg('No MCP endpoint available'); return }
    setStatus('connecting')
    setResult(null)
    setErrorMsg('')
    setLogs([])

    const images = imageUrls.split('\n').map(u => u.trim()).filter(Boolean)
    if (images.length === 0) { setErrorMsg('Enter at least one image URL'); setStatus('idle'); return }

    try {
      // Step 1: Initialize MCP session
      addLog(`Connecting to MCP: ${mcpEndpoint}`)
      const initRes = await fetch(mcpEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jsonrpc: '2.0', id: 1, method: 'initialize',
          params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'codatta-web', version: '1.0.0' } },
        }),
      })
      if (!initRes.ok) throw new Error(`MCP init failed: ${initRes.status}`)
      const sessionId = initRes.headers.get('mcp-session-id')
      addLog(`Session established: ${sessionId?.slice(0, 12)}...`)

      const mcpHeaders: Record<string, string> = { 'Content-Type': 'application/json' }
      if (sessionId) mcpHeaders['mcp-session-id'] = sessionId

      // Step 2: List tools
      addLog('Discovering tools...')
      const toolsRes = await fetch(mcpEndpoint, {
        method: 'POST', headers: mcpHeaders,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      })
      const toolsData = await toolsRes.json() as any
      const tools = toolsData.result?.tools || []
      addLog(`Found ${tools.length} tool(s): ${tools.map((t: any) => t.name).join(', ')}`)

      // Step 3: Call annotate
      setStatus('submitting')
      addLog(`Calling annotate: ${images.length} images, task=${task}`)
      const annotateRes = await fetch(mcpEndpoint, {
        method: 'POST', headers: mcpHeaders,
        body: JSON.stringify({
          jsonrpc: '2.0', id: 3, method: 'tools/call',
          params: { name: 'annotate', arguments: { images, task } },
        }),
      })
      const annotateData = await annotateRes.json() as any
      const textContent = annotateData.result?.content?.find((c: any) => c.type === 'text')
      if (!textContent) throw new Error('No result from annotate')
      const submitResult = JSON.parse(textContent.text)
      addLog(`Task submitted: ${submitResult.taskId} (status: ${submitResult.status})`)

      // Step 4: Poll get_task_status
      setStatus('polling')
      for (let i = 0; i < 30; i++) {
        await new Promise(r => setTimeout(r, 1000))
        addLog(`Polling... (${i + 1}s)`)
        const pollRes = await fetch(mcpEndpoint, {
          method: 'POST', headers: mcpHeaders,
          body: JSON.stringify({
            jsonrpc: '2.0', id: 4 + i, method: 'tools/call',
            params: { name: 'get_task_status', arguments: { taskId: submitResult.taskId } },
          }),
        })
        const pollData = await pollRes.json() as any
        const pollText = pollData.result?.content?.find((c: any) => c.type === 'text')
        if (!pollText) continue
        const pollResult = JSON.parse(pollText.text)
        if (pollResult.status === 'completed') {
          addLog(`✅ Completed in ${pollResult.duration}`)
          setResult(pollResult)
          setStatus('done')
          return
        }
        if (pollResult.status === 'failed') throw new Error('Task failed')
      }
      throw new Error('Task timed out')
    } catch (err: any) {
      addLog(`❌ Error: ${err.message}`)
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div>
      <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>
        Try the annotation service directly from your browser. This calls the MCP endpoint of the top-ranked provider.
      </p>

      {!mcpEndpoint ? (
        <div style={styles.card}>
          <p style={{ color: THEME.textMuted }}>No provider available. Register one first.</p>
        </div>
      ) : (
        <>
          <div style={{ ...styles.card, marginBottom: 16 }}>
            <p style={{ margin: '0 0 4px', fontSize: 12, color: THEME.textMuted }}>
              Provider: <strong style={{ color: THEME.textPrimary }}>{topAgent?.name}</strong> — MCP: <span style={styles.mono}>{mcpEndpoint}</span>
            </p>
          </div>

          <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
            <label>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Image URLs (one per line)</span>
              <textarea
                value={imageUrls}
                onChange={e => setImageUrls(e.target.value)}
                style={{ ...styles.input, height: 80, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                disabled={status !== 'idle' && status !== 'done' && status !== 'error'}
              />
            </label>
            <label>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Task Type</span>
              <select value={task} onChange={e => setTask(e.target.value)} style={styles.input}>
                <option value="object-detection">Object Detection</option>
                <option value="segmentation">Segmentation</option>
                <option value="classification">Classification</option>
              </select>
            </label>
            <button
              onClick={handleRun}
              disabled={status === 'connecting' || status === 'submitting' || status === 'polling'}
              style={{ ...styles.btnPrimary, opacity: (status !== 'idle' && status !== 'done' && status !== 'error') ? 0.6 : 1 }}
            >
              {status === 'idle' || status === 'done' || status === 'error' ? 'Run Annotation' :
               status === 'connecting' ? 'Connecting...' :
               status === 'submitting' ? 'Submitting...' : 'Polling...'}
            </button>
          </div>

          {/* Logs */}
          {logs.length > 0 && (
            <div style={{ ...styles.code, marginTop: 16, maxHeight: 200, overflow: 'auto' }}>
              {logs.map((log, i) => <div key={i}>{log}</div>)}
            </div>
          )}

          {/* Results */}
          {result && (
            <div style={{ marginTop: 16 }}>
              <h4>Annotation Results</h4>
              {result.annotations?.map((ann: any, i: number) => (
                <div key={i} style={{ ...styles.card, marginTop: 8 }}>
                  <p style={{ margin: 0, ...styles.mono, color: THEME.textSecondary }}>{ann.image}</p>
                  <div style={{ display: 'flex', gap: 8, marginTop: 8, flexWrap: 'wrap' }}>
                    {ann.labels?.map((label: any, j: number) => (
                      <span key={j} style={styles.badge(THEME.accentBlue)}>
                        {label.class} ({(label.confidence * 100).toFixed(0)}%)
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          )}

          {errorMsg && (
            <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}>
              <p style={{ margin: 0, color: THEME.danger }}>{errorMsg}</p>
            </div>
          )}
        </>
      )}
    </div>
  )
}

function GuideSection({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div style={styles.section}>
      <h4 style={{ margin: '0 0 8px', fontSize: 14 }}>{title}</h4>
      <div style={{ fontSize: 13, color: THEME.textPrimary, lineHeight: 1.6 }}>{children}</div>
    </div>
  )
}

function Code({ children }: { children: string }) {
  return (
    <pre style={styles.code}>{children}</pre>
  )
}
