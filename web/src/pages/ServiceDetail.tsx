import { useParams, Link, useSearchParams } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'
import { useHiddenAgents } from '../hooks/useHiddenAgents'
import { usePublicClient } from 'wagmi'
import { useEffect, useState } from 'react'
import { parseAbi } from 'viem'
import { addresses, reputationRegistryAbi } from '../config/contracts'
import { THEME, styles } from '../lib/theme'
import { ENV } from '../config/env'

const SERVICE_INFO: Record<string, { name: string; description: string }> = {
  annotation: {
    name: 'Data Annotation',
    description: 'Image labeling, object detection, semantic segmentation, and text classification.',
    providersHint: 'Providers are ranked by reputation score.',
  },
}

interface AgentWithScore {
  // null for DID-only providers
  agentId: bigint | null
  didHex: string | null
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

      function agentKey(a: typeof agents[0]): string {
        return a.agentId ? `agent:${a.agentId}` : `did:${a.didHex}`
      }

      // Filter agents: matching service type, not hidden, must be active
      const matched = agents.filter(a => {
        if (hidden.has(agentKey(a))) return false
        if (a.agentId && a.registrationFile?.active === false) return false
        if (!a.agentId && a.didMeta?.active === false) return false
        // Service type matching
        const svcType = a.registrationFile?.serviceType || a.didMeta?.serviceType
        if (svcType) return svcType === type
        const desc = (a.description || '').toLowerCase()
        if (type === 'annotation') {
          return desc.includes('annotation') || desc.includes('label') || desc.includes('detection')
        }
        return false
      })

      const withScores: AgentWithScore[] = []
      for (const agent of matched) {
        // Reputation is only applicable to ERC-8004 agents
        let score = 0
        if (agent.agentId) {
          try {
            const s = await client!.readContract({
              address: addresses.reputationRegistry, abi: repAbi,
              functionName: 'getScore', args: [agent.agentId],
            }) as bigint
            score = Number(s)
          } catch {}
        }

        withScores.push({
          agentId: agent.agentId,
          didHex: agent.didHex,
          owner: agent.owner,
          name: agent.name,
          description: agent.description,
          reputationScore: score,
          services: agent.registrationFile?.services || agent.didMeta?.services || [],
          x402Support: agent.registrationFile?.x402Support || agent.didMeta?.x402Support || false,
        })
      }

      // Sort by reputation descending (null agentId = 0 score, end of list)
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
              <p style={{ color: THEME.textMuted, fontSize: 13 }}>No providers available yet.</p>
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 12 }}>
              {rankedAgents.map((agent, rank) => {
                const hasMCP = agent.services.some(s => s.name === 'MCP')
                const hasA2A = agent.services.some(s => s.name === 'A2A')
                const isDidOnly = agent.agentId === null
                const key = isDidOnly ? `did:${agent.didHex}` : `agent:${agent.agentId}`
                const linkTo = isDidOnly ? `/did/${agent.didHex}` : `/agent/${agent.agentId!.toString()}`

                return (
                  <Link
                    key={key}
                    to={linkTo}
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
                              {isDidOnly && <Tag>DID-only</Tag>}
                            </div>
                          </div>
                          <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>
                            {agent.description.slice(0, 100)}{agent.description.length > 100 ? '...' : ''}
                          </p>
                        </div>
                        <div style={{ textAlign: 'center', flexShrink: 0 }}>
                          <div style={{ fontSize: 24, fontWeight: 'bold', color: agent.reputationScore >= 80 ? THEME.success : agent.reputationScore >= 50 ? THEME.accentOrange : THEME.textMuted }}>
                            {isDidOnly ? '—' : (agent.reputationScore || '—')}
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
        Run the client script to experience the full flow: identity registration, A2A consultation, MCP annotation, and reputation feedback.
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        <GuideSection title="Full Flow (A2A + Free Quota)">
          <ol style={{ paddingLeft: 20, fontSize: 13, lineHeight: 2 }}>
            <li><strong>A2A Consultation</strong> — Chat with the provider to learn about capabilities and pricing</li>
            <li><strong>Get Invite Code</strong> — Request an invite code during consultation</li>
            <li><strong>Register Codatta DID</strong> — Free on-chain identity registration</li>
            <li><strong>Annotate</strong> — Call <code>annotate</code> MCP tool</li>
            <li><strong>Feedback</strong> — Submit reputation score to ERC-8004</li>
          </ol>
        </GuideSection>

        <GuideSection title="Download Client Script">
          <p>
            For agent integration, download and run the client script.
            It walks through the complete flow: A2A consultation, DID registration, MCP annotation, and reputation feedback.
          </p>
          <Code>{`# Clone the repository
git clone https://github.com/codatta/codatta-ethereum-agent-demo.git
cd codatta-ethereum-agent-demo/agent

# Install dependencies
npm install

# Configure
cp .env.example .env
./sync-env.sh

# Edit .env — update the following:
#   CLIENT_PRIVATE_KEY=0xYourPrivateKeyHere
#   LOCAL_RPC_URL=https://erc8004.codatta.io/rpc
#   INVITE_SERVICE_URL=https://erc8004.codatta.io/api
#
# Your wallet needs ETH for gas. Get test ETH from
# the Faucet on the web dashboard (bottom of the page).

# Run the client
npm run start:client`}</Code>
        </GuideSection>

      </div>
    </div>
  )
}

function sleep(ms: number) { return new Promise(r => setTimeout(r, ms)) }

function AnnotationTryIt({ agents }: { agents: AgentWithScore[] }) {
  const [imageUrls, setImageUrls] = useState('https://example.com/street-001.jpg\nhttps://example.com/street-002.jpg')
  const [task, setTask] = useState('object-detection')
  const [status, setStatus] = useState<'idle' | 'submitting' | 'done' | 'error'>('idle')
  const [result, setResult] = useState<any>(null)
  const [errorMsg, setErrorMsg] = useState('')
  const [logs, setLogs] = useState<string[]>([])
  const [selectedIdx, setSelectedIdx] = useState(0)

  const selectedAgent = agents[selectedIdx] || agents[0]
  const mcpEndpoint = selectedAgent?.services.find(s => s.name === 'MCP')?.endpoint

  function addLog(msg: string) {
    setLogs(prev => [...prev, `[${new Date().toLocaleTimeString()}] ${msg}`])
  }

  async function handleRun() {
    if (!mcpEndpoint) { setErrorMsg('No provider available'); return }
    setStatus('submitting')
    setResult(null)
    setErrorMsg('')
    setLogs([])

    const images = imageUrls.split('\n').map(u => u.trim()).filter(Boolean)
    if (images.length === 0) { setErrorMsg('Enter at least one image URL'); setStatus('idle'); return }

    addLog('Initializing annotation request...')
    addLog(`Provider: ${selectedAgent?.name}`)
    addLog(`MCP endpoint: ${mcpEndpoint}`)
    addLog(`Service type: ${task}`)
    addLog(`Input: ${images.length} image(s)`)
    images.forEach((img, i) => addLog(`  [${i + 1}] ${img}`))
    addLog('')

    await sleep(300)
    addLog('Connecting to Codatta Invite Service...')
    addLog('POST /try-annotate')
    addLog(`  mcpUrl: ${mcpEndpoint}`)
    addLog(`  task: ${task}`)
    addLog(`  images: ${images.length}`)

    await sleep(200)
    addLog('')
    addLog('Invite Service → Provider REST endpoint')
    addLog('Deriving REST URL from MCP endpoint...')

    try {
      await sleep(300)
      addLog('Sending annotation request to Provider...')
      addLog('')

      const startTime = Date.now()
      const res = await fetch(ENV.INVITE_SERVICE_URL + '/try-annotate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mcpUrl: mcpEndpoint, images, task }),
      })

      const elapsed = Date.now() - startTime
      addLog(`Response received (${elapsed}ms)`)

      if (!res.ok) throw new Error(`Service unavailable: HTTP ${res.status}`)
      const data = await res.json() as any
      if (data.error) throw new Error(data.error)

      addLog(`Status: ${data.status}`)
      addLog(`Agent ID: ${data.agentId || 'N/A'}`)
      addLog('')
      addLog(`Processing ${data.annotations?.length || 0} annotation(s):`)
      addLog('')
      data.annotations?.forEach((ann: any, i: number) => {
        addLog(`  Image ${i + 1}: ${ann.image}`)
        ann.labels?.forEach((label: any) => {
          addLog(`    ├─ ${label.class}`)
          addLog(`    │  confidence: ${(label.confidence * 100).toFixed(1)}%`)
          addLog(`    │  bbox: [${label.bbox?.join(', ')}]`)
        })
        addLog('')
      })

      addLog('─'.repeat(40))
      addLog(`Total images: ${data.annotations?.length || 0}`)
      addLog(`Total labels: ${data.annotations?.reduce((sum: number, a: any) => sum + (a.labels?.length || 0), 0) || 0}`)
      addLog(`Response time: ${elapsed}ms`)
      addLog('')
      addLog('✅ Annotation completed successfully')

      setResult(data)
      setStatus('done')
    } catch (err: any) {
      addLog('')
      addLog(`❌ Error: ${err.message}`)
      addLog('Check that the Provider is running and accessible.')
      setErrorMsg(err.message)
      setStatus('error')
    }
  }

  return (
    <div>
      <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>
        Try the annotation service directly from your browser.
      </p>

      {!mcpEndpoint ? (
        <div style={styles.card}>
          <p style={{ color: THEME.textMuted }}>No provider available yet.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          {/* Left: Input */}
          <div>
            <label>
              <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Provider</span>
              <select
                value={selectedIdx}
                onChange={e => setSelectedIdx(Number(e.target.value))}
                style={styles.input}
                disabled={status === 'submitting'}
              >
                {agents.map((a, i) => (
                  <option key={i} value={i}>{a.name} (reputation: {a.reputationScore})</option>
                ))}
              </select>
            </label>

            <div style={{ display: 'grid', gap: 12 }}>
              <label>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Image URLs (one per line)</span>
                <textarea
                  value={imageUrls}
                  onChange={e => setImageUrls(e.target.value)}
                  style={{ ...styles.input, height: 100, resize: 'vertical', fontFamily: 'monospace', fontSize: 12 }}
                  disabled={status === 'submitting'}
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
                disabled={status === 'submitting'}
                style={{ ...styles.btnPrimary, opacity: status === 'submitting' ? 0.6 : 1 }}
              >
                {status === 'submitting' ? 'Annotating...' : 'Run Annotation'}
              </button>
            </div>

            {/* Results */}
            {result && (
              <div style={{ marginTop: 16 }}>
                <h4 style={{ fontSize: 14, marginBottom: 8 }}>Results</h4>
                {result.annotations?.map((ann: any, i: number) => (
                  <div key={i} style={{ ...styles.card, marginTop: 8, padding: 12 }}>
                    <p style={{ margin: 0, ...styles.mono, fontSize: 11, color: THEME.textMuted }}>{ann.image}</p>
                    <div style={{ display: 'flex', gap: 6, marginTop: 6, flexWrap: 'wrap' }}>
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
                <p style={{ margin: 0, color: THEME.danger, fontSize: 13 }}>{errorMsg}</p>
              </div>
            )}
          </div>

          {/* Right: Console */}
          <div>
            <div style={{ fontSize: 12, fontWeight: 600, color: THEME.textMuted, marginBottom: 8 }}>Console</div>
            <div style={{
              ...styles.code,
              height: 400, overflow: 'auto', margin: 0,
              fontSize: 11, lineHeight: 1.6,
            }}>
              {logs.length === 0 ? (
                <span style={{ color: '#666' }}>Click "Run Annotation" to start...</span>
              ) : (
                logs.map((log, i) => (
                  <div key={i} style={{ color: log.includes('✅') ? '#4ade80' : log.includes('❌') ? '#f87171' : log.startsWith('  ') ? '#93c5fd' : '#d4d4d4' }}>
                    {log}
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
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
