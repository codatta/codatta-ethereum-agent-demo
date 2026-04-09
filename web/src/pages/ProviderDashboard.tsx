import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useAccount, usePublicClient } from 'wagmi'
import { parseAbi, decodeEventLog, decodeAbiParameters } from 'viem'
import { addresses, identityRegistryAbi, reputationRegistryAbi, validationRegistryAbi } from '../config/contracts'
import { parseRegistrationFile, type RegistrationFile } from '../lib/parseRegistrationFile'

interface MyAgent {
  agentId: bigint
  registrationFile: RegistrationFile | null
  reputationScore: number
  validationCount: number
  didHex: string | null
}

export function ProviderDashboard() {
  const { address, isConnected } = useAccount()
  const client = usePublicClient()
  const [agents, setAgents] = useState<MyAgent[]>([])
  const [loading, setLoading] = useState(true)

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
        const repAbi = parseAbi(reputationRegistryAbi as unknown as string[])
        const valAbi = parseAbi(validationRegistryAbi as unknown as string[])

        // Find agents owned by this wallet
        const regEvent = identAbi.find(x => 'name' in x && x.name === 'Registered')!
        const logs = await client!.getLogs({
          address: addresses.identityRegistry,
          event: regEvent,
          fromBlock: 0n, toBlock: 'latest',
        })

        const myAgents: MyAgent[] = []

        for (const log of logs) {
          const decoded = decodeEventLog({ abi: identAbi, data: log.data, topics: log.topics })
          const agentId = (decoded.args as any).agentId as bigint
          const owner = (decoded.args as any).owner as string

          if (owner.toLowerCase() !== address!.toLowerCase()) continue

          // Get registration file
          const tokenUri = await client!.readContract({
            address: addresses.identityRegistry, abi: identAbi,
            functionName: 'tokenURI', args: [agentId],
          }) as string
          const regFile = parseRegistrationFile(tokenUri)

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

          // DID
          let didHex: string | null = null
          try {
            const didBytes = await client!.readContract({
              address: addresses.identityRegistry, abi: identAbi,
              functionName: 'getMetadata', args: [agentId, 'codatta:did'],
            }) as `0x${string}`
            const [did] = decodeAbiParameters([{ type: 'uint128' }], didBytes)
            didHex = (did as bigint).toString(16)
          } catch {}

          myAgents.push({ agentId, registrationFile: regFile, reputationScore, validationCount, didHex })
        }

        if (!cancelled) setAgents(myAgents)
      } catch {}
      finally { if (!cancelled) setLoading(false) }
    }

    fetch()
    return () => { cancelled = true }
  }, [client, isConnected, address])

  if (!isConnected) {
    return (
      <div>
        <h2>Provider Dashboard</h2>
        <p style={{ color: '#ca8a04' }}>Connect your wallet to view your agents.</p>
      </div>
    )
  }

  if (loading) return <p>Loading your agents...</p>

  return (
    <div>
      <h2>Provider Dashboard</h2>
      <p style={{ color: '#666', marginBottom: 20 }}>
        Manage your registered agents. Wallet: <code style={{ fontSize: 12 }}>{address?.slice(0, 10)}...{address?.slice(-4)}</code>
      </p>

      {agents.length === 0 ? (
        <div style={{ padding: 24, background: '#fafafa', borderRadius: 8, textAlign: 'center' }}>
          <p style={{ color: '#999' }}>No agents registered with this wallet.</p>
          <Link to="/register-agent" style={{ color: '#4f46e5' }}>Register a new Agent</Link>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 16 }}>
          {agents.map((agent) => {
            const reg = agent.registrationFile
            const services = reg?.services || []
            return (
              <div key={agent.agentId.toString()} style={cardStyle}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
                  <div>
                    <h3 style={{ margin: '0 0 4px' }}>{reg?.name || 'Unnamed Agent'}</h3>
                    <p style={{ margin: 0, fontSize: 12, fontFamily: 'monospace', color: '#999' }}>
                      ID: {agent.agentId.toString().slice(0, 24)}...
                    </p>
                  </div>
                  {reg?.active && (
                    <span style={{ background: '#dcfce7', color: '#166534', padding: '2px 8px', borderRadius: 12, fontSize: 12 }}>Active</span>
                  )}
                </div>

                {/* Stats */}
                <div style={{ display: 'flex', gap: 24, marginTop: 16 }}>
                  <Stat label="Reputation" value={agent.reputationScore.toString()} color={agent.reputationScore >= 80 ? '#16a34a' : '#ca8a04'} />
                  <Stat label="Validations" value={agent.validationCount.toString()} />
                  <Stat label="Services" value={services.length.toString()} />
                </div>

                {/* DID */}
                {agent.didHex && (
                  <div style={{ marginTop: 12, fontSize: 12 }}>
                    <span style={{ color: '#999' }}>DID: </span>
                    <Link to={`/did/${agent.didHex}`} style={{ fontFamily: 'monospace', color: '#4f46e5' }}>
                      did:codatta:{agent.didHex.slice(0, 16)}...
                    </Link>
                  </div>
                )}

                {/* Endpoints */}
                {services.length > 0 && (
                  <div style={{ marginTop: 12 }}>
                    <span style={{ fontSize: 12, color: '#999' }}>Endpoints:</span>
                    <div style={{ display: 'flex', gap: 8, marginTop: 4, flexWrap: 'wrap' }}>
                      {services.map((svc, i) => (
                        <span key={i} style={{ fontSize: 11, padding: '2px 8px', background: '#f3f4f6', borderRadius: 4, fontFamily: 'monospace' }}>
                          {svc.name}: {svc.endpoint.length > 30 ? svc.endpoint.slice(0, 30) + '...' : svc.endpoint}
                        </span>
                      ))}
                    </div>
                  </div>
                )}

                {/* Actions */}
                <div style={{ display: 'flex', gap: 10, marginTop: 14 }}>
                  <Link to={`/agent/${agent.agentId.toString()}`} style={actionStyle}>View Details</Link>
                  <Link to="/invites" style={actionStyle}>View Invites</Link>
                </div>
              </div>
            )
          })}
        </div>
      )}

      <div style={{ marginTop: 24 }}>
        <Link to="/register-agent" style={{ color: '#4f46e5', fontSize: 14 }}>+ Register another Agent</Link>
      </div>

      {/* Get Started Guide */}
      <div style={{ marginTop: 32 }}>
        <h3>Get Started as a Provider</h3>
        <p style={{ color: '#666', fontSize: 13, marginBottom: 16 }}>
          Follow these steps to register your Agent and start providing data services on the Codatta platform.
        </p>

        <div style={{ display: 'grid', gap: 12 }}>
          <StepCard num={1} title="Register Your Agent" done={agents.length > 0}>
            <p>Create a Codatta DID and register your Agent on ERC-8004. This establishes your on-chain identity, reputation history, and service endpoints.</p>
            {agents.length === 0 && <Link to="/register-agent" style={{ color: '#4f46e5', fontSize: 13 }}>Register now →</Link>}
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
    </div>
  )
}

function StepCard({ num, title, done, children }: { num: number; title: string; done?: boolean; children: React.ReactNode }) {
  return (
    <div style={{ border: '1px solid #e5e7eb', borderRadius: 8, padding: 16, background: done ? '#f0fdf4' : 'white' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
        <div style={{
          width: 26, height: 26, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
          fontSize: 13, fontWeight: 'bold', flexShrink: 0,
          background: done ? '#16a34a' : '#4f46e5', color: 'white',
        }}>
          {done ? '✓' : num}
        </div>
        <strong style={{ fontSize: 14 }}>{title}</strong>
      </div>
      <div style={{ fontSize: 13, color: '#374151', lineHeight: 1.6, paddingLeft: 36 }}>{children}</div>
    </div>
  )
}

function Stat({ label, value, color }: { label: string; value: string; color?: string }) {
  return (
    <div>
      <div style={{ fontSize: 22, fontWeight: 'bold', color: color || '#111' }}>{value}</div>
      <div style={{ fontSize: 12, color: '#999' }}>{label}</div>
    </div>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: 'white',
}
const actionStyle: React.CSSProperties = {
  fontSize: 12, padding: '4px 12px', borderRadius: 6, border: '1px solid #d1d5db',
  textDecoration: 'none', color: '#374151',
}
