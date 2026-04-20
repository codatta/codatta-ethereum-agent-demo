import { useState, useEffect } from 'react'
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseAbi, decodeEventLog, encodeAbiParameters, toHex } from 'viem'
import { addresses, didRegistrarAbi, didRegistryAbi, identityRegistryAbi } from '../config/contracts'
import { Link } from 'react-router-dom'
import { THEME, styles } from '../lib/theme'
import { ENV, hexToDidUri, didUriToHex } from '../config/env'
import { NetworkCheck } from '../components/NetworkCheck'

const SERVICE_TYPES = [
  { id: 'annotation', name: 'Data Annotation', description: 'Image labeling, object detection, segmentation, classification', requiredTools: ['annotate', 'get_task_status'] },
]

type Step = 'did' | 'service' | 'verify' | 'publish' | 'done'

// Form state persisted to localStorage (keyed by wallet address)
type DraftState = {
  step: Step
  didHex: string
  selectedService: string | null
  name: string
  description: string
  baseUrl: string
  webUrl: string
  mcpUrl: string
  a2aUrl: string
}

function draftKey(address: string | undefined) {
  return address ? `register-agent-draft:${address.toLowerCase()}` : null
}

function loadDraft(address: string | undefined): Partial<DraftState> | null {
  const key = draftKey(address)
  if (!key) return null
  try {
    const raw = localStorage.getItem(key)
    return raw ? JSON.parse(raw) : null
  } catch {
    return null
  }
}

function saveDraft(address: string | undefined, draft: DraftState) {
  const key = draftKey(address)
  if (!key) return
  try {
    localStorage.setItem(key, JSON.stringify(draft))
  } catch {}
}

function clearDraft(address: string | undefined) {
  const key = draftKey(address)
  if (!key) return
  try {
    localStorage.removeItem(key)
  } catch {}
}

export function RegisterAgent() {
  const { isConnected, address } = useAccount()
  const { connect } = useConnect()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [step, setStep] = useState<Step>('did')
  const [selectedService, setSelectedService] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [baseUrl, setBaseUrl] = useState('')
  const [webUrl, setWebUrl] = useState('')
  const [mcpUrl, setMcpUrl] = useState('')
  const [a2aUrl, setA2aUrl] = useState('')
  const [didHex, setDidHex] = useState('')
  const [agentId, setAgentId] = useState('')
  const [existingDid, setExistingDid] = useState('')
  const [verifyStatus, setVerifyStatus] = useState<'idle' | 'checking' | 'pass' | 'fail'>('idle')
  const [verifyError, setVerifyError] = useState('')
  const [txLoading, setTxLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [draftLoaded, setDraftLoaded] = useState(false)

  // Load draft on mount / address change
  useEffect(() => {
    if (!address) return
    const draft = loadDraft(address)
    if (draft) {
      if (draft.step) setStep(draft.step)
      if (draft.didHex) setDidHex(draft.didHex)
      if (draft.selectedService !== undefined) setSelectedService(draft.selectedService)
      if (draft.name) setName(draft.name)
      if (draft.description) setDescription(draft.description)
      if (draft.baseUrl) setBaseUrl(draft.baseUrl)
      if (draft.webUrl) setWebUrl(draft.webUrl)
      if (draft.mcpUrl) setMcpUrl(draft.mcpUrl)
      if (draft.a2aUrl) setA2aUrl(draft.a2aUrl)
    }
    setDraftLoaded(true)
  }, [address])

  // Persist draft on any change (after initial load)
  useEffect(() => {
    if (!draftLoaded || !address) return
    // Don't persist terminal state
    if (step === 'done') return
    saveDraft(address, { step, didHex, selectedService, name, description, baseUrl, webUrl, mcpUrl, a2aUrl })
  }, [draftLoaded, address, step, didHex, selectedService, name, description, baseUrl, webUrl, mcpUrl, a2aUrl])

  function resetDraft() {
    clearDraft(address)
    setStep('did')
    setDidHex('')
    setSelectedService(null)
    setName('')
    setDescription('')
    setBaseUrl('')
    setWebUrl('')
    setMcpUrl('')
    setA2aUrl('')
    setExistingDid('')
    setVerifyStatus('idle')
    setVerifyError('')
    setError(null)
  }

  function deriveEndpoints(base: string) {
    setBaseUrl(base)
    try {
      const url = new URL(base.includes('://') ? base : `http://${base}`)
      const host = `${url.protocol}//${url.hostname}`
      setWebUrl(`${host}:${ENV.DEFAULT_PORTS.web}`)
      setMcpUrl(`${host}:${ENV.DEFAULT_PORTS.mcp}/mcp`)
      setA2aUrl(`${host}:${ENV.DEFAULT_PORTS.a2a}/.well-known/agent-card.json`)
    } catch {
      setWebUrl('')
      setMcpUrl('')
      setA2aUrl('')
    }
    setVerifyStatus('idle')
    setVerifyError('')
  }

  if (!isConnected) {
    return (
      <div>
        <h2>New Agent</h2>
        <NetworkCheck />
        <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>Connect your wallet to create a new agent.</p>
        <button onClick={() => connect({ connector: injected() })} style={styles.btnPrimary}>
          Connect Wallet
        </button>
      </div>
    )
  }

  // ── Step 1: DID ────────────────────────────────────────────────
  if (step === 'did') {
    return (
      <div>
        <h2>New Agent</h2>
        <NetworkCheck />
        <StepIndicator current="did" onReset={resetDraft} />
        <p style={{ color: THEME.textSecondary, marginBottom: 20 }}>
          First, register a Codatta DID. This is your on-chain identity for providing services.
        </p>

        <div style={{ display: 'grid', gap: 16, maxWidth: 500 }}>
          {/* Use existing DID */}
          <div style={styles.card}>
            <strong>I already have a Codatta DID</strong>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input
                placeholder="did:codatta:xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx"
                value={existingDid}
                onChange={e => setExistingDid(e.target.value)}
                style={{ ...styles.input, flex: 1 }}
              />
              <button
                onClick={() => {
                  const hex = didUriToHex(existingDid)
                  if (hex) { setDidHex(hex); setStep('service') }
                }}
                disabled={!existingDid}
                style={{ ...styles.btnPrimary, opacity: existingDid ? 1 : 0.4, whiteSpace: 'nowrap' }}
              >
                Use DID
              </button>
            </div>
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
                        setStep('service')
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
      </div>
    )
  }

  // ── Step 2: Service — select type + endpoints + write to DID doc ─
  if (step === 'service') {
    const svc = SERVICE_TYPES.find(s => s.id === selectedService)

    return (
      <div>
        <h2>New Agent</h2>
        <NetworkCheck />
        <StepIndicator current="service" onReset={resetDraft} />

        <div style={{ ...styles.card, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>DID:</strong> <span style={styles.mono}>{hexToDidUri(didHex)}</span>
          </p>
        </div>

        <p style={{ color: THEME.textSecondary, marginBottom: 20 }}>
          Declare what service your Agent provides and add it to your DID document.
        </p>

        <div style={{ display: 'grid', gap: 16, maxWidth: 500 }}>
          {/* Service type selection */}
          <div>
            <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 8 }}>Service Type</span>
            <div style={{ display: 'grid', gap: 8 }}>
              {SERVICE_TYPES.map(s => (
                <div
                  key={s.id}
                  onClick={() => {
                    if (selectedService === s.id) {
                      setSelectedService(null)
                      setName('')
                      setDescription('')
                    } else {
                      setSelectedService(s.id)
                      setName(`Codatta ${s.name} Agent`)
                      setDescription(s.description)
                    }
                  }}
                  style={{
                    ...styles.card,
                    cursor: 'pointer',
                    border: selectedService === s.id ? `2px solid ${THEME.accentBlue}` : '2px solid transparent',
                  }}
                >
                  <strong>{s.name}</strong>
                  <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>{s.description}</p>
                  <p style={{ margin: '6px 0 0', fontSize: 12, color: THEME.textMuted }}>
                    Required MCP tools: {s.requiredTools.map(t => <code key={t} style={{ marginRight: 4 }}>{t}</code>)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          {selectedService && (
            <>
              {/* Agent info */}
              <label>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Agent Name</span>
                <input value={name} onChange={e => setName(e.target.value)} style={styles.input} />
              </label>
              <label>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Description</span>
                <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...styles.input, height: 80, resize: 'vertical' }} />
              </label>

              {/* Endpoint configuration */}
              <label>
                <span style={{ display: 'block', fontSize: 13, fontWeight: 600, marginBottom: 4 }}>Base URL</span>
                <input
                  placeholder="http://your-server-ip"
                  value={baseUrl}
                  onChange={e => deriveEndpoints(e.target.value)}
                  style={styles.input}
                />
                <p style={{ fontSize: 11, color: THEME.textMuted, margin: '4px 0 0' }}>
                  Use a public IP or domain. Other endpoints are derived automatically.
                </p>
              </label>

              {baseUrl && (
                <>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, color: THEME.textMuted, marginBottom: 2 }}>HTTP REST</span>
                    <input value={webUrl} onChange={e => setWebUrl(e.target.value)} style={{ ...styles.input, ...styles.mono, fontSize: 12 }} />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, color: THEME.textMuted, marginBottom: 2 }}>MCP</span>
                    <input value={mcpUrl} onChange={e => setMcpUrl(e.target.value)} style={{ ...styles.input, ...styles.mono, fontSize: 12 }} />
                  </label>
                  <label>
                    <span style={{ display: 'block', fontSize: 12, color: THEME.textMuted, marginBottom: 2 }}>A2A</span>
                    <input value={a2aUrl} onChange={e => setA2aUrl(e.target.value)} style={{ ...styles.input, ...styles.mono, fontSize: 12 }} />
                  </label>
                </>
              )}

              {/* Proceed to verification (no on-chain writes yet) */}
              <button
                onClick={() => setStep('verify')}
                disabled={!name || !mcpUrl}
                style={{ ...styles.btnPrimary, opacity: !name || !mcpUrl ? 0.5 : 1 }}
              >
                Next: Verify Service
              </button>
              <p style={{ fontSize: 12, color: THEME.textMuted, margin: 0 }}>
                We'll verify your MCP endpoint before writing anything on-chain.
              </p>
            </>
          )}
        </div>

        {/* Demo download hint */}
        {selectedService && (
          <div style={{ ...styles.card, marginTop: 12, maxWidth: 500, background: THEME.accentBlueLight }}>
            <p style={{ margin: 0, fontSize: 13 }}>
              <strong>Don't have a service yet?</strong> Download and run the pre-built provider:
            </p>
            <pre style={{ ...styles.code, margin: '8px 0 0', fontSize: 11 }}>{`git clone <repo-url>
cd agent && npm install
cp .env.example .env && ./sync-env.sh
npm run start:provider
# MCP URL will be on port ${ENV.DEFAULT_PORTS.mcp}`}</pre>
          </div>
        )}

        {error && <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}><p style={{ margin: 0, color: THEME.danger }}>{error}</p></div>}

        <button onClick={() => setStep('did')} style={{ ...styles.btnSecondary, marginTop: 16 }}>
          &larr; Back
        </button>
      </div>
    )
  }

  // ── Step 3: Verify MCP endpoints ───────────────────────────────
  if (step === 'verify') {
    const svc = SERVICE_TYPES.find(s => s.id === selectedService)

    return (
      <div>
        <h2>New Agent</h2>
        <NetworkCheck />
        <StepIndicator current="verify" onReset={resetDraft} />

        <div style={{ ...styles.card, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>DID:</strong> <span style={styles.mono}>{hexToDidUri(didHex)}</span>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>
            <strong>MCP:</strong> <span style={styles.mono}>{mcpUrl}</span>
          </p>
        </div>

        <p style={{ color: THEME.textSecondary, marginBottom: 16 }}>
          Verify that your MCP service is running and exposes the required tools.
        </p>

        <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
          <p style={{ fontSize: 13, color: THEME.textMuted, margin: 0 }}>
            Required MCP tools: {svc?.requiredTools.map(t => <code key={t} style={{ marginRight: 4 }}>{t}</code>)}
          </p>

          <button
            onClick={async () => {
              setVerifyStatus('checking')
              setVerifyError('')
              try {
                const res = await fetch(ENV.INVITE_SERVICE_URL + '/verify-mcp', {
                  method: 'POST',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ mcpUrl, requiredTools: svc?.requiredTools || [] }),
                })
                if (!res.ok) throw new Error('Verification service unavailable')
                const data = await res.json() as { status: string; error?: string }
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
            disabled={verifyStatus === 'checking'}
            style={styles.btnPrimary}
          >
            {verifyStatus === 'checking' ? 'Verifying...' : 'Verify Service'}
          </button>
        </div>

        {verifyStatus === 'pass' && (
          <div style={{ ...styles.card, marginTop: 16, background: 'rgba(34,197,94,0.06)', maxWidth: 500 }}>
            <p style={{ margin: 0, color: THEME.success, fontWeight: 600 }}>Verification passed!</p>
            <p style={{ margin: '8px 0 0', fontSize: 13, color: THEME.textSecondary }}>
              Your MCP endpoint exposes all required tools. Publish the service to your DID document.
            </p>
            <button
              onClick={() => setStep('publish')}
              style={{ ...styles.btnPrimary, marginTop: 12 }}
            >
              Next
            </button>
          </div>
        )}

        {verifyStatus === 'fail' && (
          <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)', maxWidth: 500 }}>
            <p style={{ margin: 0, color: THEME.danger, fontWeight: 600 }}>Verification failed</p>
            <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>{verifyError}</p>
          </div>
        )}

        <button onClick={() => setStep('service')} style={{ ...styles.btnSecondary, marginTop: 16 }}>
          &larr; Back
        </button>
      </div>
    )
  }

  // ── Step 4: Publish Service to DID ─────────────────────────────
  if (step === 'publish') {
    return (
      <div>
        <h2>New Agent</h2>
        <NetworkCheck />
        <StepIndicator current="publish" onReset={resetDraft} />

        <p style={{ color: THEME.textSecondary, marginBottom: 20 }}>
          Publish your service endpoints to the DID document on-chain. This makes your Agent usable within Codatta.
        </p>

        <div style={{ ...styles.card, marginBottom: 16 }}>
          <p style={{ margin: 0, fontSize: 13 }}>
            <strong>DID:</strong> <span style={styles.mono}>{hexToDidUri(didHex)}</span>
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>
            <strong>Service:</strong> {SERVICE_TYPES.find(s => s.id === selectedService)?.name}
          </p>
          <p style={{ margin: '4px 0 0', fontSize: 13 }}>
            <strong>MCP:</strong> <span style={styles.mono}>{mcpUrl}</span>
          </p>
          {a2aUrl && (
            <p style={{ margin: '4px 0 0', fontSize: 13 }}>
              <strong>A2A:</strong> <span style={styles.mono}>{a2aUrl}</span>
            </p>
          )}
        </div>

        <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
          <button
            onClick={async () => {
              if (!client) return
              setTxLoading(true)
              setError(null)
              try {
                const didIdentifier = BigInt(`0x${didHex}`)
                const didAbi = parseAbi(didRegistryAbi as unknown as string[])
                const didUri = hexToDidUri(didHex)

                // 1. Publish profile JSON (ERC-8004 registrationFile format) to profile service.
                //    Single source of truth: both DID doc and future ERC-8004 tokenURI point here.
                const profile = {
                  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
                  name, description,
                  serviceType: selectedService,
                  image: 'https://codatta.io/agents/default/avatar.png',
                  services: [
                    ...(webUrl ? [{ name: 'web', endpoint: webUrl }] : []),
                    { name: 'MCP', endpoint: mcpUrl, version: '2025-06-18' },
                    ...(a2aUrl ? [{ name: 'A2A', endpoint: a2aUrl, version: '0.3.0' }] : []),
                    { name: 'DID', endpoint: didUri, version: 'v1' },
                  ],
                  active: true,
                  supportedTrust: ['reputation'],
                  x402Support: true,
                }
                const profileUrl = `${ENV.INVITE_SERVICE_URL}/profiles/${didUri}`
                const putRes = await fetch(profileUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(profile),
                })
                if (!putRes.ok) throw new Error(`Profile publish failed: HTTP ${putRes.status}`)

                // 2. Write a single AgentProfile pointer to the DID document.
                //    DID document stays identity-only; endpoints live in the profile JSON.
                const profilePointer = JSON.stringify({
                  id: `${didUri}#profile`,
                  type: 'AgentProfile',
                  serviceEndpoint: profileUrl,
                })
                const hash = await writeContractAsync({
                  address: addresses.didRegistry, abi: didAbi,
                  functionName: 'addItemToAttribute',
                  args: [didIdentifier, didIdentifier, 'service', toHex(new TextEncoder().encode(profilePointer))],
                })
                await client.waitForTransactionReceipt({ hash })

                clearDraft(address)
                setStep('done')
              } catch (err: any) {
                setError(err.shortMessage || err.message)
              } finally {
                setTxLoading(false)
              }
            }}
            disabled={txLoading}
            style={{ ...styles.btnPrimary, opacity: txLoading ? 0.5 : 1 }}
          >
            {txLoading ? 'Publishing (1 upload + 1 tx)...' : 'Publish to DID (1 upload + 1 tx)'}
          </button>
        </div>

        {error && <div style={{ ...styles.card, marginTop: 16, background: 'rgba(239,68,68,0.04)' }}><p style={{ margin: 0, color: THEME.danger }}>{error}</p></div>}

        <button onClick={() => setStep('verify')} style={{ ...styles.btnSecondary, marginTop: 16 }}>&larr; Back</button>
      </div>
    )
  }

  // ── Done ────────────────────────────────────────────────────────
  return (
    <div>
      <h2>Agent Published!</h2>
      <div style={{ ...styles.card, background: 'rgba(34,197,94,0.06)' }}>
        <p><strong>DID:</strong> <Link to={`/did/${didHex}`} style={{ fontFamily: 'monospace' }}>{hexToDidUri(didHex)}</Link></p>
        <p><strong>Name:</strong> {name}</p>
        <p><strong>Service:</strong> {SERVICE_TYPES.find(s => s.id === selectedService)?.name}</p>
        <p><strong>MCP:</strong> <span style={styles.mono}>{mcpUrl}</span></p>
        {agentId && (
          <>
            <p><strong>Agent ID (ERC-8004):</strong> <span style={styles.mono}>{agentId}</span></p>
            <p style={{ margin: '8px 0', fontSize: 13, color: THEME.textSecondary }}>
              To enable ERC-8004 in your provider, run in <span style={{ fontFamily: 'monospace' }}>agent/</span> and restart:
            </p>
            <div style={{ position: 'relative' }}>
              <pre style={{ ...styles.code, margin: 0, fontSize: 12, paddingRight: 60 }}>{`npm run set-agent-id ${agentId}`}</pre>
              <button
                onClick={() => navigator.clipboard.writeText(`npm run set-agent-id ${agentId}`)}
                style={{ position: 'absolute', top: 8, right: 8, border: 'none', background: 'rgba(255,255,255,0.12)', borderRadius: 4, padding: '4px 12px', cursor: 'pointer', fontSize: 13, color: 'rgba(255,255,255,0.6)' }}
              >
                copy
              </button>
            </div>
          </>
        )}
        <p style={{ margin: '12px 0 0', color: THEME.success }}>
          {agentId
            ? 'Agent is active and discoverable via Codatta and ERC-8004.'
            : 'Agent is active within Codatta. Register on ERC-8004 below to make it discoverable by external clients.'}
        </p>
        <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
          {agentId && <Link to={`/agent/${agentId}`} style={{ ...styles.btnPrimary, textDecoration: 'none' }}>View Agent</Link>}
          <Link to={`/did/${didHex}`} style={{ ...styles.btnSecondary, textDecoration: 'none' }}>View DID</Link>
          <Link to="/dashboard" style={{ ...styles.btnSecondary, textDecoration: 'none' }}>My Agents</Link>
        </div>
      </div>

      {/* Optional: Register on ERC-8004 */}
      {!agentId && (
        <div style={{ ...styles.card, marginTop: 16, maxWidth: 600 }}>
          <strong>Optional: Register on ERC-8004</strong>
          <p style={{ margin: '4px 0 12px', fontSize: 13, color: THEME.textSecondary }}>
            Adds an Agent ID on the ERC-8004 IdentityRegistry, linked to your DID.
            This lets external clients discover and interact with your Agent via the ERC-8004 standard.
          </p>
          <button
            onClick={async () => {
              if (!client) return
              setTxLoading(true)
              setError(null)
              try {
                const didIdentifier = BigInt(`0x${didHex}`)
                const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
                const didAbi = parseAbi(didRegistryAbi as unknown as string[])
                const didUri = hexToDidUri(didHex)
                const profileUrl = `${ENV.INVITE_SERVICE_URL}/profiles/${didUri}`

                // Re-publish profile to profile service in case the DID step was skipped
                // or profile data has changed. Profile is single source of truth for both
                // the DID document's #profile pointer and ERC-8004's tokenURI.
                const profile = {
                  type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
                  name, description,
                  serviceType: selectedService,
                  image: 'https://codatta.io/agents/default/avatar.png',
                  services: [
                    ...(webUrl ? [{ name: 'web', endpoint: webUrl }] : []),
                    { name: 'MCP', endpoint: mcpUrl, version: '2025-06-18' },
                    ...(a2aUrl ? [{ name: 'A2A', endpoint: a2aUrl, version: '0.3.0' }] : []),
                    { name: 'DID', endpoint: didUri, version: 'v1' },
                  ],
                  active: true,
                  supportedTrust: ['reputation'], x402Support: true,
                }
                const putRes = await fetch(profileUrl, {
                  method: 'PUT',
                  headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify(profile),
                })
                if (!putRes.ok) throw new Error(`Profile publish failed: HTTP ${putRes.status}`)

                // 1. Register on ERC-8004 — tokenURI points to the profile URL
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
                const h2 = await writeContractAsync({
                  address: addresses.identityRegistry, abi: identAbi,
                  functionName: 'setMetadata', args: [aid, 'codatta:did', didBytes],
                })
                await client.waitForTransactionReceipt({ hash: h2 })

                // 3. Link: DID → ERC-8004 (addItemToAttribute)
                const erc8004Service = JSON.stringify({
                  id: `${didUri}#erc8004`,
                  type: 'ERC8004Agent',
                  serviceEndpoint: `eip155:${ENV.CHAIN_ID}:${addresses.identityRegistry}#${aid}`,
                })
                const h3 = await writeContractAsync({
                  address: addresses.didRegistry, abi: didAbi,
                  functionName: 'addItemToAttribute',
                  args: [didIdentifier, didIdentifier, 'service', toHex(new TextEncoder().encode(erc8004Service))],
                })
                await client.waitForTransactionReceipt({ hash: h3 })

                // 4. Update profile with agentId in registrations array (profile re-PUT, no extra tx)
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

                setAgentId(aid.toString())
              } catch (err: any) {
                setError(err.shortMessage || err.message)
              } finally {
                setTxLoading(false)
              }
            }}
            disabled={txLoading}
            style={{ ...styles.btnPrimary, opacity: txLoading ? 0.5 : 1 }}
          >
            {txLoading ? 'Registering (3 tx)...' : 'Register on ERC-8004 (3 tx + profile PUT)'}
          </button>
          {error && <p style={{ margin: '12px 0 0', color: THEME.danger, fontSize: 13 }}>{error}</p>}
        </div>
      )}
    </div>
  )
}

function StepIndicator({ current, onReset }: { current: Step; onReset?: () => void }) {
  const steps: { key: Step; label: string }[] = [
    { key: 'did', label: 'DID' },
    { key: 'service', label: 'Service' },
    { key: 'verify', label: 'Verify' },
    { key: 'publish', label: 'Publish' },
  ]
  const currentIdx = steps.findIndex(s => s.key === current)

  return (
    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
      <div style={{ display: 'flex', gap: 4 }}>
        {steps.map((s, i) => (
          <div key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
            <div style={{
              width: 24, height: 24, borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center',
              fontSize: 12, fontWeight: 600,
              background: i < currentIdx ? THEME.success : i === currentIdx ? THEME.btnPrimary : THEME.canvas,
              color: i <= currentIdx ? THEME.surface : THEME.textMuted,
            }}>
              {i < currentIdx ? '\u2713' : i + 1}
            </div>
            <span style={{ fontSize: 12, color: i === currentIdx ? THEME.textPrimary : THEME.textMuted, fontWeight: i === currentIdx ? 600 : 400 }}>
              {s.label}
            </span>
            {i < steps.length - 1 && <span style={{ color: THEME.textMuted, margin: '0 4px' }}>&rarr;</span>}
          </div>
        ))}
      </div>
      {onReset && currentIdx > 0 && (
        <button
          onClick={onReset}
          style={{ background: 'transparent', border: 'none', color: THEME.textMuted, fontSize: 12, cursor: 'pointer', textDecoration: 'underline' }}
        >
          Start Over
        </button>
      )}
    </div>
  )
}
