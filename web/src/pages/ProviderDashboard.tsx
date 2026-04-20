import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, usePublicClient, useWriteContract } from 'wagmi'
import { parseAbi, decodeEventLog, decodeAbiParameters, encodeAbiParameters, toHex, hexToString } from 'viem'
import { addresses, didRegistryAbi, identityRegistryAbi, reputationRegistryAbi, validationRegistryAbi } from '../config/contracts'
import { useHiddenAgents } from '../hooks/useHiddenAgents'
import { parseRegistrationFile, type RegistrationFile } from '../lib/parseRegistrationFile'
import { THEME, styles } from '../lib/theme'
import { ENV, hexToDidUri, normalizeEndpoint } from '../config/env'

interface MyAgent {
  // null for DID-only entries
  agentId: bigint | null
  // null only if ERC-8004 agent has no DID linked
  didHex: string | null
  registrationFile: RegistrationFile | null
  reputationScore: number
  validationCount: number
  // For DID-only: services parsed from DID document
  didServices: Array<{ name: string; endpoint: string }>
  // For DID-only: whether CodattaAgent metadata exists (discoverable)
  hasMetadata?: boolean
}

export function ProviderDashboard() {
  const { address, isConnected } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [agents, setAgents] = useState<MyAgent[]>([])
  const [loading, setLoading] = useState(true)
  const { hidden, hideAgent, showAgent } = useHiddenAgents()
  const [filter, setFilter] = useState<'visible' | 'hidden' | 'inactive' | 'all'>('visible')
  const [tab, setTab] = useState<'agents' | 'guide'>('agents')
  const [bindingDid, setBindingDid] = useState<string | null>(null)
  const [bindError, setBindError] = useState<string | null>(null)
  const [reloadTick, setReloadTick] = useState(0)
  const [boundResult, setBoundResult] = useState<{ didHex: string; agentId: string } | null>(null)
  const [publishingDid, setPublishingDid] = useState<string | null>(null)
  const [publishError, setPublishError] = useState<string | null>(null)

  useEffect(() => {
    if (!client || !isConnected || !address) {
      setLoading(false)
      return
    }
    let cancelled = false

    async function fetch() {
      try {
        setLoading(true)
        const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
        const didAbi = parseAbi(didRegistryAbi as unknown as string[])
        const repAbi = parseAbi(reputationRegistryAbi as unknown as string[])
        const valAbi = parseAbi(validationRegistryAbi as unknown as string[])

        // ── 1. Find ERC-8004 agents owned by this wallet ────────────
        const regEvent = identAbi.find(x => 'name' in x && x.name === 'Registered')!
        const logs = await client!.getLogs({
          address: addresses.identityRegistry,
          event: regEvent,
          fromBlock: 0n, toBlock: 'latest',
        })

        const myAgents: MyAgent[] = []
        const linkedDids = new Set<string>()

        for (const log of logs) {
          const decoded = decodeEventLog({ abi: identAbi, data: log.data, topics: log.topics })
          const agentId = (decoded.args as any).agentId as bigint
          const owner = (decoded.args as any).owner as string

          if (owner.toLowerCase() !== address!.toLowerCase()) continue

          // Registration file
          const tokenUri = await client!.readContract({
            address: addresses.identityRegistry, abi: identAbi,
            functionName: 'tokenURI', args: [agentId],
          }) as string
          const regFile = await parseRegistrationFile(tokenUri)

          // Reputation
          let reputationScore = 0
          try {
            const score = await client!.readContract({
              address: addresses.reputationRegistry, abi: repAbi,
              functionName: 'getScore', args: [agentId],
            }) as bigint
            reputationScore = Number(score)
          } catch {}

          // Validation count
          let validationCount = 0
          try {
            const valEvent = valAbi.find(x => 'name' in x && x.name === 'ValidationRequest')!
            const valLogs = await client!.getLogs({
              address: addresses.validationRegistry,
              event: valEvent,
              args: { agentId },
              fromBlock: 0n, toBlock: 'latest',
            })
            validationCount = valLogs.length
          } catch {}

          // Linked DID
          let didHex: string | null = null
          try {
            const didBytes = await client!.readContract({
              address: addresses.identityRegistry, abi: identAbi,
              functionName: 'getMetadata', args: [agentId, 'codatta:did'],
            }) as `0x${string}`
            const [did] = decodeAbiParameters([{ type: 'uint128' }], didBytes)
            didHex = (did as bigint).toString(16)
            linkedDids.add(didHex)
          } catch {}

          myAgents.push({ agentId, didHex, registrationFile: regFile, reputationScore, validationCount, didServices: [] })
        }

        // ── 2. Find DIDs owned by this wallet (DID-only entries) ───
        let ownedDids: bigint[] = []
        try {
          ownedDids = (await client!.readContract({
            address: addresses.didRegistry, abi: didAbi,
            functionName: 'getOwnedDids', args: [address!],
          }) as readonly bigint[]).slice()
        } catch {}

        for (const didId of ownedDids) {
          const didHex = didId.toString(16)
          if (linkedDids.has(didHex)) continue // already counted as ERC-8004 agent

          // Resolve profile from DID document's #profile pointer, then fetch registrationFile
          let didServices: Array<{ name: string; endpoint: string }> = []
          let hasMetadata = false
          try {
            const docResult = await client!.readContract({
              address: addresses.didRegistry, abi: didAbi,
              functionName: 'getDidDocument', args: [didId],
            }) as any
            const arrayAttrs = docResult[4] as any[]
            let profileUrl: string | null = null
            for (const attr of arrayAttrs) {
              const name = attr[0] || attr.name
              if (name !== 'service') continue
              const values = attr[1] || attr.values || []
              for (const item of values) {
                const val = item[0] || item.value
                const revoked = item[1] || item.revoked || false
                if (revoked) continue
                try {
                  const text = hexToString(val)
                  const parsed = JSON.parse(text)
                  if (parsed.type === 'AgentProfile' && parsed.serviceEndpoint) {
                    profileUrl = parsed.serviceEndpoint
                  }
                } catch {}
              }
            }
            if (profileUrl) {
              const profile = await parseRegistrationFile(profileUrl)
              if (profile) {
                hasMetadata = true
                didServices = (profile.services || [])
                  .filter(s => s.name === 'MCP' || s.name === 'A2A')
                  .map(s => ({ name: s.name, endpoint: s.endpoint }))
              }
            }
          } catch {}

          myAgents.push({
            agentId: null,
            didHex,
            registrationFile: null,
            reputationScore: 0,
            validationCount: 0,
            didServices,
            hasMetadata,
          })
        }

        if (!cancelled) setAgents(myAgents)
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    }

    fetch()
    return () => { cancelled = true }
  }, [client, isConnected, address, reloadTick])

  async function bindAgentId(didHex: string) {
    if (!client || !address) return
    setBindingDid(didHex)
    setBindError(null)
    try {
      const didIdentifier = BigInt(`0x${didHex}`)
      const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
      const didAbi = parseAbi(didRegistryAbi as unknown as string[])

      // Fetch existing profile from profile service — the single source of truth
      const didUri = hexToDidUri(didHex)
      const profileUrl = `${ENV.INVITE_SERVICE_URL}/profiles/${didUri}`
      const existing = await parseRegistrationFile(profileUrl)
      const profile = existing || {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: 'Codatta Agent',
        description: 'Agent registered via Codatta DID',
        image: 'https://codatta.io/agents/default/avatar.png',
        services: [{ name: 'DID', endpoint: didUri, version: 'v1' }],
        active: true,
        supportedTrust: ['reputation'], x402Support: true,
      }
      // Ensure profile exists on profile service (re-PUT is idempotent)
      const putRes = await fetch(profileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      if (!putRes.ok) throw new Error(`Profile publish failed: HTTP ${putRes.status}`)

      // 1. Register on ERC-8004 — tokenURI points to profile URL
      const regHash = await writeContractAsync({
        address: addresses.identityRegistry, abi: identAbi,
        functionName: 'register', args: [profileUrl],
      })
      const regReceipt = await client.waitForTransactionReceipt({ hash: regHash })

      let aid = 0n
      for (const log of regReceipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: identAbi, data: log.data, topics: log.topics })
          if (decoded.eventName === 'Registered') { aid = (decoded.args as any).agentId as bigint; break }
        } catch {}
      }
      if (!aid) throw new Error('Agent registration failed')

      // 2. Link: ERC-8004 → DID (setMetadata)
      const didBytes = encodeAbiParameters([{ type: 'uint128' }], [didIdentifier])
      const bh2 = await writeContractAsync({
        address: addresses.identityRegistry, abi: identAbi,
        functionName: 'setMetadata', args: [aid, 'codatta:did', didBytes],
      })
      await client.waitForTransactionReceipt({ hash: bh2 })

      // 3. Link: DID → ERC-8004 (addItemToAttribute)
      const erc8004Service = JSON.stringify({
        id: `${didUri}#erc8004`,
        type: 'ERC8004Agent',
        serviceEndpoint: `eip155:${ENV.CHAIN_ID}:${addresses.identityRegistry}#${aid}`,
      })
      const bh3 = await writeContractAsync({
        address: addresses.didRegistry, abi: didAbi,
        functionName: 'addItemToAttribute',
        args: [didIdentifier, didIdentifier, 'service', toHex(new TextEncoder().encode(erc8004Service))],
      })
      await client.waitForTransactionReceipt({ hash: bh3 })

      // 4. Update profile with agentId in registrations (re-PUT to profile service, no tx)
      const finalProfile = {
        ...profile,
        registrations: [{ agentId: aid.toString(), agentRegistry: addresses.identityRegistry }],
      }
      const putFinal = await fetch(profileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(finalProfile),
      })
      if (!putFinal.ok) throw new Error(`Profile update failed: HTTP ${putFinal.status}`)

      setBoundResult({ didHex, agentId: aid.toString() })
      setReloadTick(t => t + 1)
    } catch (err: any) {
      setBindError(err.shortMessage || err.message)
    } finally {
      setBindingDid(null)
    }
  }

  async function publishMetadata(didHex: string) {
    if (!client) return
    setPublishingDid(didHex)
    setPublishError(null)
    try {
      const didIdentifier = BigInt(`0x${didHex}`)
      const didAbi = parseAbi(didRegistryAbi as unknown as string[])
      const didUri = hexToDidUri(didHex)
      const profileUrl = `${ENV.INVITE_SERVICE_URL}/profiles/${didUri}`

      // Publish default profile (ERC-8004 registrationFile format) to profile service
      const profile = {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name: 'Codatta Annotation Agent',
        description: 'Image annotation service by Codatta. Supports object detection, semantic segmentation, and classification.',
        serviceType: 'annotation',
        image: 'https://codatta.io/agents/default/avatar.png',
        services: [{ name: 'DID', endpoint: didUri, version: 'v1' }],
        active: true,
        supportedTrust: ['reputation'],
        x402Support: true,
      }
      const putRes = await fetch(profileUrl, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(profile),
      })
      if (!putRes.ok) throw new Error(`Profile publish failed: HTTP ${putRes.status}`)

      // Add AgentProfile pointer to DID document
      const profilePointer = JSON.stringify({
        id: `${didUri}#profile`,
        type: 'AgentProfile',
        serviceEndpoint: profileUrl,
      })
      await writeContractAsync({
        address: addresses.didRegistry, abi: didAbi,
        functionName: 'addItemToAttribute',
        args: [didIdentifier, didIdentifier, 'service', toHex(new TextEncoder().encode(profilePointer))],
      })
      setReloadTick(t => t + 1)
    } catch (err: any) {
      setPublishError(err.shortMessage || err.message)
    } finally {
      setPublishingDid(null)
    }
  }

  if (!isConnected) {
    return (
      <div>
        <h2>Provider</h2>
        <p style={{ color: THEME.accentOrange }}>Connect your wallet to view your agents.</p>
      </div>
    )
  }

  if (loading) return <p>Loading your agents...</p>

  function agentKey(a: MyAgent): string {
    return a.agentId ? `agent:${a.agentId}` : `did:${a.didHex}`
  }

  const filteredAgents = agents.filter(a => {
    const isHidden = hidden.has(agentKey(a))
    // DID-only entries: treat as active
    const isActive = a.agentId === null ? true : a.registrationFile?.active === true
    if (filter === 'visible') return !isHidden && isActive
    if (filter === 'hidden') return isHidden
    if (filter === 'inactive') return !isHidden && !isActive
    return true
  })

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
        <h2 style={{ margin: 0 }}>Provider</h2>
        <Link to="/register-agent" style={{ ...styles.btnPrimary, textDecoration: 'none' }}>+ New Agent</Link>
      </div>

      {/* Post-bind: show instructions to enable ERC-8004 in the local provider */}
      {boundResult && (
        <div style={{ ...styles.card, marginBottom: 16, background: 'rgba(34,197,94,0.06)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div>
              <strong>Agent ID bound successfully</strong>
              <p style={{ margin: '4px 0 0', fontSize: 13 }}>
                <span style={{ color: THEME.textMuted }}>Agent ID:</span>{' '}
                <span style={styles.mono}>{boundResult.agentId}</span>
                <button
                  onClick={() => navigator.clipboard.writeText(boundResult.agentId)}
                  style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: THEME.accentBlue, marginLeft: 8 }}
                >
                  Copy
                </button>
              </p>
            </div>
            <button
              onClick={() => setBoundResult(null)}
              style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.textMuted, fontSize: 18 }}
              title="Dismiss"
            >
              ×
            </button>
          </div>

          <p style={{ margin: '12px 0 6px', fontSize: 13, color: THEME.textSecondary }}>
            To enable ERC-8004 features in your provider, run the following in the{' '}
            <span style={styles.mono}>agent/</span> directory and restart:
          </p>
          <div style={{ position: 'relative' }}>
            <pre style={{ ...styles.code, margin: 0, fontSize: 12, paddingRight: 60 }}>
{`npm run set-agent-id ${boundResult.agentId}`}
            </pre>
            <button
              onClick={() => navigator.clipboard.writeText(`npm run set-agent-id ${boundResult.agentId}`)}
              style={{ position: 'absolute', top: 8, right: 8, border: 'none', background: 'rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}
            >
              copy
            </button>
          </div>
        </div>
      )}

      {/* Page tabs */}
      <div style={{ display: 'flex', gap: 0, borderBottom: `2px solid ${THEME.canvas}`, marginBottom: 20 }}>
        <TabBtn label="My Agents" active={tab === 'agents'} onClick={() => setTab('agents')} />
        <TabBtn label="Get Started" active={tab === 'guide'} onClick={() => setTab('guide')} />
      </div>

      {tab === 'agents' && (<>

      {/* Filter */}
      <div style={{ display: 'flex', gap: 8, marginBottom: 16 }}>
        <FilterButton label="Visible" active={filter === 'visible'} onClick={() => setFilter('visible')} count={agents.filter(a => !hidden.has(agentKey(a)) && (a.agentId === null || a.registrationFile?.active === true)).length} />
        <FilterButton label="Inactive" active={filter === 'inactive'} onClick={() => setFilter('inactive')} count={agents.filter(a => !hidden.has(agentKey(a)) && a.agentId !== null && a.registrationFile?.active !== true).length} />
        <FilterButton label="Hidden" active={filter === 'hidden'} onClick={() => setFilter('hidden')} count={agents.filter(a => hidden.has(agentKey(a))).length} />
        <FilterButton label="All" active={filter === 'all'} onClick={() => setFilter('all')} count={agents.length} />
      </div>

      {filteredAgents.length === 0 ? (
        <div style={{ ...styles.card, textAlign: 'center' }}>
          <p style={{ color: THEME.textMuted }}>
            {filter === 'hidden' ? 'No hidden agents.' : filter === 'visible' ? 'No visible agents.' : filter === 'inactive' ? 'No inactive agents.' : 'No agents registered yet.'}
          </p>
          {agents.length === 0 && (
            <Link to="/register-agent" style={{ color: THEME.accentBlue }}>Register your first Agent</Link>
          )}
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {filteredAgents.map((agent) => {
            const reg = agent.registrationFile
            const services = reg?.services || agent.didServices
            const key = agentKey(agent)
            const isDidOnly = agent.agentId === null
            return (
              <div key={key} style={styles.card}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px' }}>{reg?.name || (isDidOnly ? 'Codatta Agent (DID-only)' : 'Unnamed Agent')}</h3>
                    {agent.agentId && (
                      <p style={{ margin: 0, ...styles.mono, fontSize: 12, color: THEME.textMuted, display: 'flex', alignItems: 'center', gap: 6 }}>
                        <span style={{ userSelect: 'all' }}>ID: {agent.agentId.toString()}</span>
                        <button
                          onClick={(e) => { e.stopPropagation(); navigator.clipboard.writeText(agent.agentId!.toString()) }}
                          style={{ border: 'none', background: 'none', cursor: 'pointer', fontSize: 12, color: THEME.accentBlue, padding: 0 }}
                          title="Copy Agent ID"
                        >
                          Copy
                        </button>
                      </p>
                    )}
                  </div>
                  {hidden.has(key) ? (
                    <span style={styles.badge(THEME.danger)}>Hidden</span>
                  ) : isDidOnly ? (
                    <span style={styles.badge(THEME.accentOrange)}>DID-only</span>
                  ) : reg?.active ? (
                    <span style={styles.badge(THEME.success)}>Active</span>
                  ) : (
                    <span style={styles.badge(THEME.textMuted)}>Inactive</span>
                  )}
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
                  <Stat label="Reputation" value={agent.reputationScore.toString()} color={agent.reputationScore >= 80 ? THEME.success : THEME.accentOrange} />
                  <Stat label="Validations" value={agent.validationCount.toString()} />
                  <Stat label="Services" value={services.length.toString()} />
                </div>

                {/* DID */}
                {agent.didHex && (
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    <span style={{ color: THEME.textMuted }}>DID: </span>
                    <Link to={`/did/${agent.didHex}`} style={{ fontFamily: 'monospace', color: THEME.accentBlue }}>
                      {hexToDidUri(agent.didHex)}
                    </Link>
                  </div>
                )}

                {/* Endpoints */}
                {services.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 12, color: THEME.textMuted }}>Endpoints:</span>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {services.map((svc, i) => (
                        <span key={i} style={{ fontSize: 11, padding: '2px 8px', background: THEME.canvas, borderRadius: THEME.radiusButton, fontFamily: 'monospace' }}>
                          {svc.name}: {(() => {
                            const ep = normalizeEndpoint(svc.endpoint)
                            return ep.length > 30 ? ep.slice(0, 30) + '...' : ep
                          })()}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Warning if DID-only entry is missing CodattaAgent metadata */}
                {isDidOnly && !agent.hasMetadata && (
                  <div style={{ marginTop: 10, padding: 10, background: 'rgba(251,191,36,0.08)', borderRadius: THEME.radiusInput, fontSize: 12 }}>
                    <strong style={{ color: THEME.accentOrange }}>Incomplete profile</strong>
                    <span style={{ color: THEME.textSecondary, marginLeft: 6 }}>
                      Missing metadata — agent won't appear in the Services list until you publish it.
                    </span>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, marginTop: 14, alignItems: 'center', flexWrap: 'wrap' }}>
                  {agent.agentId && (
                    <Link to={`/agent/${agent.agentId.toString()}`} style={styles.btnSecondary}>View Details</Link>
                  )}
                  {isDidOnly && agent.didHex && !agent.hasMetadata && (
                    <button
                      onClick={() => publishMetadata(agent.didHex!)}
                      disabled={publishingDid === agent.didHex}
                      style={{ ...styles.btnPrimary, opacity: publishingDid === agent.didHex ? 0.5 : 1 }}
                    >
                      {publishingDid === agent.didHex ? 'Publishing...' : 'Publish Metadata'}
                    </button>
                  )}
                  {isDidOnly && agent.didHex && (
                    <button
                      onClick={() => bindAgentId(agent.didHex!)}
                      disabled={bindingDid === agent.didHex}
                      style={{ ...styles.btnPrimary, opacity: bindingDid === agent.didHex ? 0.5 : 1 }}
                    >
                      {bindingDid === agent.didHex ? 'Binding...' : 'Bind Agent ID (ERC-8004)'}
                    </button>
                  )}
                  <Link to="/invites" style={styles.btnSecondary}>View Invites</Link>
                  {hidden.has(key) ? (
                    <button onClick={() => showAgent(key)} style={styles.btnSuccess}>
                      Show in Services
                    </button>
                  ) : (
                    <button onClick={() => hideAgent(key)} style={styles.btnDanger}>
                      Hide from Services
                    </button>
                  )}
                </div>

                {bindError && bindingDid === null && agent.didHex && (
                  <p style={{ margin: '8px 0 0', color: THEME.danger, fontSize: 12 }}>{bindError}</p>
                )}
                {publishError && publishingDid === null && agent.didHex && (
                  <p style={{ margin: '8px 0 0', color: THEME.danger, fontSize: 12 }}>{publishError}</p>
                )}
              </div>
            )
          })}
        </div>
      )}


      </>)}

      {/* Get Started Guide */}
      {tab === 'guide' && (
      <div>
        <h3>Get Started as a Provider</h3>
        <p style={{ color: THEME.textSecondary, fontSize: 13, marginBottom: 16 }}>
          Follow these steps to register your Agent and start providing data services on the Codatta platform.
        </p>

        <div style={{ display: 'grid', gap: 12 }}>
          <StepCard num={1} title="Register Your Agent" done={agents.length > 0}>
            <p>Create a Codatta DID and register your Agent on ERC-8004. This establishes your on-chain identity, reputation history, and service endpoints.</p>
            {agents.length === 0 && <Link to="/register-agent" style={{ color: THEME.accentBlue, fontSize: 13 }}>Register now →</Link>}
          </StepCard>

          <StepCard num={2} title="Implement MCP Service">
            <p>Expose your annotation capabilities as MCP tools. Clients discover your tools via <code>tools/list</code> and invoke them via <code>tools/call</code>.</p>
            <p><strong>Required tools:</strong></p>
            <ul style={{ margin: '4px 0', paddingLeft: 20 }}>
              <li><code>annotate</code> — submit images for annotation (async, returns taskId)</li>
              <li><code>get_task_status</code> — poll for task completion</li>
              <li><code>claim_invite</code> — claim invite codes for free quota</li>
            </ul>
          </StepCard>

          <StepCard num={3} title="Enable A2A Consultation (Optional)">
            <p>Add an A2A endpoint so clients can chat with your Agent before committing. Useful for explaining capabilities, negotiating pricing, and issuing invite codes.</p>
          </StepCard>

          <StepCard num={4} title="Start Serving">
            <p>Once registered, your Agent appears in the service marketplace. Clients can discover you, check your reputation, and call your MCP tools. Deliver quality results to build your reputation score.</p>
          </StepCard>
        </div>

      </div>
      )}
    </div>
  )
}

function TabBtn({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
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

function StepCard({ num, title, done, children }: { num: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ ...styles.card, background: done ? 'rgba(34,197,94,0.06)' : THEME.surface }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 'bold', flexShrink: 0,
          background: done ? THEME.success : THEME.btnPrimary, color: THEME.surface,
        }}>
          {done ? '✓' : num}
        </div>
        <strong style={{ fontSize: 14 }}>{title}</strong>
      </div>
      <div style={{ fontSize: 13, color: THEME.textPrimary, lineHeight: 1.6, paddingLeft: 36 }}>{children}</div>
    </div>
  )
}

function FilterButton({ label, active, onClick, count }: { label: string; active: boolean; onClick: () => void; count: number }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: THEME.radiusButton, border: 'none', cursor: 'pointer',
      fontSize: 13, fontWeight: active ? 600 : 400,
      background: active ? THEME.btnPrimary : THEME.canvas,
      color: active ? THEME.surface : THEME.textSecondary,
    }}>
      {label} ({count})
    </button>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 'bold', color: color || THEME.textPrimary }}>{value}</div>
      <div style={{ fontSize: 12, color: THEME.textMuted }}>{label}</div>
    </div>
  )
}
