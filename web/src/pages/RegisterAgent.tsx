import { useState, useEffect } from 'react'
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseAbi, decodeEventLog, decodeAbiParameters, encodeAbiParameters, toHex } from 'viem'
import { addresses, didRegistrarAbi, didRegistryAbi, identityRegistryAbi } from '../config/contracts'
import { Link } from 'react-router-dom'
import { THEME, styles } from '../lib/theme'

const SERVICE_TYPES = [
  { id: 'annotation', name: 'Data Annotation', description: 'Image labeling, object detection, segmentation, classification', requiredTools: ['annotate', 'get_task_status'] },
]

type Step = 'service' | 'did' | 'agent' | 'verify' | 'done'

export function RegisterAgent() {
  const { isConnected } = useAccount()
  const { connect } = useConnect()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [step, setStep] = useState<Step>('service')
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [didHex, setDidHex] = useState('')
  const [agentId, setAgentId] = useState('')
  const [existingDid, setExistingDid] = useState('')
  const [detectedDid, setDetectedDid] = useState<string | null>(null)
  const [detectingDid, setDetectingDid] = useState(false)
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'pass' | 'fail'>('idle')
  const [verifyError, setVerifyError] = useState('')
  const [txLoading, setTxLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const { address } = useAccount()

  // Detect existing DID from on-chain agents owned by this wallet
  useEffect(() => {
    if (!client || !address || step !== 'did' || detectedDid) return
    let cancelled = false

    async function detect() {
      setDetectingDid(true)
      try {
        const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
        const regEvent = identAbi.find(x => 'name' in x && x.name === 'Registered')!
        const logs = await client!.getLogs({
          address: addresses.identityRegistry, event: regEvent,
          fromBlock: 0n, toBlock: 'latest',
        })

        for (const log of logs) {
          const decoded = decodeEventLog({ abi: identAbi, data: log.data, topics: log.topics })
          const owner = (decoded.args as any).owner as string
          if (owner.toLowerCase() !== address!.toLowerCase()) continue

          const agentId = (decoded.args as any).agentId as bigint
          try {
            const didBytes = await client!.readContract({
              address: addresses.identityRegistry, abi: identAbi,
              functionName: 'getMetadata', args: [agentId, 'codatta:did'],
            }) as `0x${string}`
            const [did] = decodeAbiParameters([{ type: 'uint128' }], didBytes)
            const hex = (did as bigint).toString(16)
            if (!cancelled) {
              setDetectedDid(hex)
              setExistingDid(`did:codatta:${hex}`)
            }
            return
          } catch {}
        }
      } catch {}
      if (!cancelled) setDetectingDid(false)
    }

    detect()
    return () => { cancelled = true }
  }, [client, address, step, detectedDid])

  if (!isConnected) {
    return (
      <div>
        <h2>New Agent</h2>
        <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>Connect your wallet to create a new agent.</p>
        <button onClick={() => connect({ connector: injected() })} style={styles.btnPrimary}>
          Connect Wallet
        </button>
      </div>
    )
  }

  // ── Step 1: Select service type ─────────────────────────────
  if (step === 'service') {
    return (
      <div>
        <h2>New Agent</h2>
        <StepIndicator current="service" />
        <p style={{ color: THEME.textSecondary, marginBottom: 20 }}>Choose the type of service your Agent will provide.</p>

        <div style={{ display: 'grid', gap: 12 }}>
          {SERVICE_TYPES.map(svc => (
            <div
              key={svc.id}
              onClick={() => {
                setSelectedService(svc.id)
                setName(`Codatta ${svc.name} Agent`)
                setDescription(svc.description)
              }}
              style={{
                ...styles.card,
                cursor: 'pointer',
                border: selectedService === svc.id ? `2px solid ${THEME.accentBlue}` : '2px solid transparent',
              }}
            >
              <strong>{svc.name}</strong>
              <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>{svc.description}</p>
              <p style={{ margin: '6px 0 0', fontSize: 12, color: THEME.textMuted }}>
                Required MCP tools: {svc.requiredTools.map(t => <code key={t} style={{ marginRight: 4 }}>{t}</code>)}
              </p>
            </div>
          ))}
        </div>

        <button
          onClick={() => selectedService && setStep('did')}
          disabled={!selectedService}
          style={{ ...styles.btnPrimary, marginTop: 20, opacity: selectedService ? 1 : 0.4 }}
        >
          Next
        </button>
      </div>
    )
  }

  // ── Step 2: DID ─────────────────────────────────────────────
  if (step === 'did') {
    return (
      <div>
        <h2>New Agent</h2>
        <StepIndicator current="did" />
        <p style={{ color: THEME.textSecondary, marginBottom: 20 }}>
          Your Agent needs a Codatta DID. {detectedDid ? 'We found an existing DID for your wallet.' : 'If you already have one, enter it below.'}
        </p>

        <div style={{ display: 'grid', gap: 16, maxWidth: 500 }}>
          {/* Detected / Existing DID */}
          <div style={{ ...styles.card, border: detectedDid ? `2px solid ${THEME.success}` : undefined }}>
            <strong>{detectedDid ? 'Existing DID found' : 'I already have a Codatta DID'}</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                placeholder="did:codatta:abc123..."
                value={existingDid}
                onChange={e => setExistingDid(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
              />
              <button
                onClick={() => {
                  const hex = existingDid.replace('did:codatta:', '')
                  if (hex) { setDidHex(hex); setStep('agent') }
                }}
                disabled={!existingDid}
                style={{ ...styles.btnPrimary, opacity: existingDid ? 1 : 0.4, whiteSpace: 'nowrap' }}
              >
                {detectedDid ? 'Use this DID' : 'Use DID'}
              </button>
            </div>
            {detectedDid && (
              <p style={{ margin: '6px 0 0', fontSize: 12, color: THEME.success }}>
                Auto-detected from your existing agents
              </p>
            )}
          </div>

          {/* Register new */}
          <div style={styles.card}>
            <strong>Register a new DID</strong>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>
              Free on-chain registration. Creates a unique identity for your Agent.
            </p>
            <button
              onClick={async () => {
                if (!client) return
                setTxLoading(true)
                setError(null)
                try {
                  const hash = await writeContractAsync({
                    address: addresses.didRegistrar,
                    abi: parseAbi(didRegistrarAbi as unknown as string[]),
                    functionName: 'register',
                  })
                  const receipt = await client.waitForTransactionReceipt({ hash })
                  const didAbi = parseAbi(didRegistryAbi as unknown as string[])
                  for (const log of receipt.logs) {
                    try {
                      const decoded = decodeEventLog({ abi: didAbi, data: log.data, topics: log.topics })
                      if (decoded.eventName === 'DIDRegistered') {
                        const id = (decoded.args as any).identifier as bigint
                        setDidHex(id.toString(16))
                        setStep('agent')
                        break
                      }
                    } catch {}
                  }
                } catch (err: any) {
                  setError(err.shortMessage || err.message)
                } finally {
                  setTxLoading(false)
                }
              }}
              disabled={txLoading}
              style={{ ...styles.btnPrimary, marginTop: 12, opacity: txLoading ? 0.6 : 1 }}
            >
              {txLoading ? 'Registering...' : 'Register New DID'}
            </button>
          </div>
        </div>

        {error && <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}><p style={{ margin: 0, color: THEME.danger }}>{error}</p></div>}

        <button onClick={() => setStep('service')} style={{ ...styles.btnSecondary, marginTop: 16 }}>
          ← Back
        </button>
      </div>
    )
  }

  // ── Step 3: Register ERC-8004 Agent ─────────────────────────
  if (step === 'agent') {
    return (
      <div>
        <h2>New Agent</h2>
        <StepIndicator current="agent" />
        <p style={{ color: THEME.textSecondary, marginBottom: 20 }}>
          Register your agent on ERC-8004 and link it to your DID.
        </p>

        <div style={{ ...styles.card, marginBottom: 12 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>DID:</strong> <span style={styles.mono}>did:codatta:{didHex}</span>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>
            <strong>Service:</strong> {SERVICE_TYPES.find(s => s.id === selectedService)?.name}
          </p>
        </div>

        <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Agent Name</span>
            <input value={name} onChange={e => setName(e.target.value)} style={styles.input} />
          </label>
          <label>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Description</span>
            <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...styles.input, height: 80, resize: 'vertical' }} />
          </label>

          <button
            onClick={async () => {
              if (!client) return
              setTxLoading(true)
              setError(null)
              try {
                const didIdentifier = BigInt(`0x${didHex}`)
                const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
                const didAbi = parseAbi(didRegistryAbi as unknown as string[])

                // Register on ERC-8004 (no endpoints yet — will add after verification)
                const regFile = {
                  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
                  name, description,
                  serviceType: selectedService,
                  image: 'https://codatta.io/agents/default/avatar.png',
                  services: [
                    { name: 'DID', endpoint: `did:codatta:${didHex}`, version: 'v1' },
                  ],
                  active: false,
                  registrations: [],
                  supportedTrust: ['reputation'], x402Support: true,
                }
                const tokenUri = `data:application/json;base64,${btoa(JSON.stringify(regFile))}`

                const regHash = await writeContractAsync({
                  address: addresses.identityRegistry, abi: identAbi,
                  functionName: 'register', args: [tokenUri],
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
                setAgentId(aid.toString())

                // Link: ERC-8004 → DID
                const didBytes = encodeAbiParameters([{ type: 'uint128' }], [didIdentifier])
                await writeContractAsync({
                  address: addresses.identityRegistry, abi: identAbi,
                  functionName: 'setMetadata', args: [aid, 'codatta:did', didBytes],
                })

                // Link: DID → ERC-8004
                const serviceEndpoint = JSON.stringify({
                  id: `did:codatta:${didHex}#erc8004`,
                  type: 'ERC8004Agent',
                  serviceEndpoint: `eip155:31337:${addresses.identityRegistry}#${aid}`,
                })
                await writeContractAsync({
                  address: addresses.didRegistry, abi: didAbi,
                  functionName: 'addItemToAttribute',
                  args: [didIdentifier, didIdentifier, 'service', toHex(new TextEncoder().encode(serviceEndpoint))],
                })

                setStep('verify')
              } catch (err: any) {
                setError(err.shortMessage || err.message)
              } finally {
                setTxLoading(false)
              }
            }}
            disabled={txLoading || !name}
            style={{ ...styles.btnPrimary, opacity: txLoading || !name ? 0.5 : 1 }}
          >
            {txLoading ? 'Registering (3 transactions)...' : 'Register Agent'}
          </button>
        </div>

        {error && <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}><p style={{ margin: 0, color: THEME.danger }}>{error}</p></div>}

        <button onClick={() => setStep('did')} style={{ ...styles.btnSecondary, marginTop: 16 }}>← Back</button>
      </div>
    )
  }

  // ── Step 4: Verify MCP URL ──────────────────────────────────
  if (step === 'verify') {
    const svc = SERVICE_TYPES.find(s => s.id === selectedService)

    return (
      <div>
        <h2>New Agent</h2>
        <StepIndicator current="verify" />

        <div style={{ ...styles.card, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Agent ID:</strong> <span style={{ ...styles.mono, userSelect: 'all' }}>{agentId}</span>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>
            <strong>DID:</strong> <span style={styles.mono}>did:codatta:{didHex}</span>
          </p>
        </div>

        <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>
          Deploy your MCP service, then paste the URL below. We'll verify that it exposes the required tools.
        </p>

        <p style={{ fontSize: 13, color: THEME.textMuted, marginBottom: 12 }}>
          Required tools: {svc?.requiredTools.map(t => <code key={t} style={{ marginRight: 4 }}>{t}</code>)}
        </p>

        <div style={{ display: 'flex', gap: 8, maxWidth: 500 }}>
          <input
            placeholder="http://your-server-ip:4022/mcp"
            value={mcpUrl}
            onChange={e => { setMcpUrl(e.target.value); setVerifyStatus('idle'); setVerifyError('') }}
            style={{ ...styles.input, flex: 1 }}
          />
          <button
            onClick={async () => {
              setVerifyStatus('checking')
              setVerifyError('')
              try {
                // Server-side verification via Invite Service
                const res = await fetch('http://127.0.0.1:4060/verify-mcp', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({
                    mcpUrl,
                    requiredTools: svc?.requiredTools || [],
                  }),
                })
                if (!res.ok) throw new Error(`Verification service unavailable`)
                const data = await res.json() as { status: string; error?: string; tools?: string[] }
                if (data.status === 'pass') {
                  setVerifyStatus('pass')
                } else {
                  setVerifyStatus('fail')
                  setVerifyError(data.error || 'Verification failed')
                }
              } catch (err: any) {
                setVerifyStatus('fail')
                setVerifyError(err.message)
              }
            }}
            disabled={!mcpUrl || verifyStatus === 'checking'}
            style={{ ...styles.btnPrimary, opacity: !mcpUrl ? 0.4 : 1, whiteSpace: 'nowrap' }}
          >
            {verifyStatus === 'checking' ? 'Verifying...' : 'Verify'}
          </button>
        </div>

        <p style={{ fontSize: 12, color: THEME.textMuted, marginTop: 8, maxWidth: 500 }}>
          Use a public IP or domain. The server needs to reach your MCP endpoint to verify tools.
        </p>

        {/* Demo download hint */}
        <div style={{ ...styles.card, marginTop: 12, maxWidth: 500, background: THEME.accentBlueLight }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>Don't have a service yet?</strong> Download and run the pre-built provider:
          </p>
          <pre style={{ ...styles.code, margin: '8px 0 0', fontSize: 11 }}>{`git clone <repo-url>
cd agent && npm install
cp .env.example .env && ./sync-env.sh
npm run start:provider
# MCP URL will be: http://localhost:4022/mcp`}</pre>
        </div>

        {verifyStatus === 'pass' && (
          <div style={{ ...styles.card, marginTop: 16, background: 'rgba(34,197,94,0.06)' }}>
            <p style={{ margin: 0, color: THEME.success, fontWeight: 600 }}>✅ Verification passed!</p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: THEME.textSecondary }}>
              Your MCP endpoint exposes all required tools. Click below to finalize registration.
            </p>
            <button
              onClick={async () => {
                if (!client) return
                setTxLoading(true)
                setError(null)
                try {
                  const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
                  const aid = BigInt(agentId)

                  // Update registration file with MCP endpoint + set active
                  const regFile = {
                    type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
                    name, description,
                    serviceType: selectedService,
                    image: 'https://codatta.io/agents/default/avatar.png',
                    services: [
                      { name: 'MCP', endpoint: mcpUrl, version: '2025-06-18' },
                      { name: 'DID', endpoint: `did:codatta:${didHex}`, version: 'v1' },
                    ],
                    active: true,
                    registrations: [{ agentId, agentRegistry: addresses.identityRegistry }],
                    supportedTrust: ['reputation'], x402Support: true,
                  }
                  const tokenUri = `data:application/json;base64,${btoa(JSON.stringify(regFile))}`
                  await writeContractAsync({
                    address: addresses.identityRegistry, abi: identAbi,
                    functionName: 'setAgentUri', args: [aid, tokenUri],
                  })

                  setStep('done')
                } catch (err: any) {
                  setError(err.shortMessage || err.message)
                } finally {
                  setTxLoading(false)
                }
              }}
              disabled={txLoading}
              style={{ ...styles.btnPrimary, marginTop: 12, opacity: txLoading ? 0.6 : 1 }}
            >
              {txLoading ? 'Finalizing...' : 'Finalize Registration'}
            </button>
          </div>
        )}

        {verifyStatus === 'fail' && (
          <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}>
            <p style={{ margin: 0, color: THEME.danger, fontWeight: 600 }}>❌ Verification failed</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>{verifyError}</p>
          </div>
        )}

        {error && <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}><p style={{ margin: 0, color: THEME.danger }}>{error}</p></div>}
      </div>
    )
  }

  // ── Done ────────────────────────────────────────────────────
  return (
    <div>
      <h2>Agent Created!</h2>
      <div style={{ ...styles.card, background: 'rgba(34,197,94,0.06)' }}>
        <p><strong>Agent ID:</strong> <span style={styles.mono}>{agentId}</span></p>
        <p><strong>DID:</strong> <Link to={`/did/${didHex}`} style={{ fontFamily: 'monospace' }}>did:codatta:{didHex}</Link></p>
        <p><strong>Name:</strong> {name}</p>
        <p><strong>Service:</strong> {SERVICE_TYPES.find(s => s.id === selectedService)?.name}</p>
        <p><strong>MCP:</strong> <span style={styles.mono}>{mcpUrl}</span></p>
        <p style={{ margin: '12px 0 0', color: THEME.success }}>
          ✅ Agent is active and discoverable on ERC-8004.
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          <Link to={`/agent/${agentId}`} style={{ ...styles.btnPrimary, textDecoration: 'none' }}>View Agent</Link>
          <Link to="/dashboard" style={{ ...styles.btnSecondary, textDecoration: 'none' }}>My Agents</Link>
        </div>
      </div>
    </div>
  )
}

function StepIndicator({ current }: { current: Step }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'service', label: 'Service' },
    { key: 'did', label: 'DID' },
    { key: 'agent', label: 'Register' },
    { key: 'verify', label: 'Verify' },
  ]
  const currentIdx = steps.findIndex(s => s.key === current)

  return (
    <div style={{ display: 'flex', gap: 4, marginBottom: 20 }}>
      {steps.map((s, i) => (
        <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
          <div style={{
            width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, fontWeight: 600,
            background: i < currentIdx ? THEME.success : i === currentIdx ? THEME.btnPrimary : THEME.canvas,
            color: i <= currentIdx ? THEME.surface : THEME.textMuted,
          }}>
            {i < currentIdx ? '✓' : i + 1}
          </div>
          <span style={{ fontSize: 12, color: i === currentIdx ? THEME.textPrimary : THEME.textMuted, fontWeight: i === currentIdx ? 600 : 400 }}>
            {s.label}
          </span>
          {i < steps.length - 1 && <span style={{ color: THEME.textMuted, margin: '0 4px' }}>→</span>}
        </div>
      ))}
    </div>
  )
}
