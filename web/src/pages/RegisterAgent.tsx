import { useState } from 'react'
import { useAccount, useConnect, useWriteContract, usePublicClient } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { parseAbi, decodeEventLog, encodeAbiParameters, toHex } from 'viem'
import { addresses, didRegistrarAbi, didRegistryAbi, identityRegistryAbi } from '../config/contracts'
import { Link } from 'react-router-dom'

const STEPS = [
  {
    title: 'Register Codatta DID',
    description: 'Create an on-chain decentralized identity (DID) for your Agent. This is free and generates a unique identifier (did:codatta:xxx) that serves as your Agent\'s permanent identity in the Codatta ecosystem.',
  },
  {
    title: 'Register on ERC-8004',
    description: 'Register your Agent in the ERC-8004 Identity Registry. This creates an NFT-based agent identity with a registration file containing your Agent\'s name, description, and service endpoints. Other agents and clients can discover you through this registry.',
  },
  {
    title: 'Link DID ↔ ERC-8004',
    description: 'Establish bidirectional linkage between your Codatta DID and ERC-8004 agent identity. This writes a reference from ERC-8004 to your DID (via metadata), and from your DID to ERC-8004 (via service endpoint). Anyone can verify the two identities belong to the same Agent.',
  },
]

export function RegisterAgent() {
  const { isConnected } = useAccount()
  const { connect } = useConnect()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [name, setName] = useState('My Annotation Agent')
  const [description, setDescription] = useState('AI agent for data annotation services.')
  const [webEndpoint, setWebEndpoint] = useState('http://localhost:4021')

  const [step, setStep] = useState(0) // 0=form, 1/2/3=in progress, 4=done
  const [didHex, setDidHex] = useState('')
  const [agentId, setAgentId] = useState('')
  const [error, setError] = useState<string | null>(null)

  async function handleRegister() {
    if (!client) return
    setError(null)

    try {
      // Step 1: Register DID
      setStep(1)
      const didHash = await writeContractAsync({
        address: addresses.didRegistrar,
        abi: parseAbi(didRegistrarAbi as unknown as string[]),
        functionName: 'register',
      })
      const didReceipt = await client.waitForTransactionReceipt({ hash: didHash })
      const didAbi = parseAbi(didRegistryAbi as unknown as string[])

      let didIdentifier = 0n
      for (const log of didReceipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: didAbi, data: log.data, topics: log.topics })
          if (decoded.eventName === 'DIDRegistered') {
            didIdentifier = (decoded.args as any).identifier as bigint
            break
          }
        } catch {}
      }
      if (!didIdentifier) throw new Error('DID registration failed — no event emitted')
      const hex = didIdentifier.toString(16)
      setDidHex(hex)

      // Step 2: Register Agent on ERC-8004
      setStep(2)
      const regFile = {
        type: 'https://eips.ethereum.org/EIPS/eip-8004#registration-v1',
        name, description,
        image: 'https://codatta.io/agents/default/avatar.png',
        services: [
          { name: 'web', endpoint: webEndpoint },
          { name: 'DID', endpoint: `did:codatta:${hex}`, version: 'v1' },
        ],
        active: true, registrations: [],
        supportedTrust: ['reputation'], x402Support: true,
      }
      const tokenUri = `data:application/json;base64,${btoa(JSON.stringify(regFile))}`
      const identAbi = parseAbi(identityRegistryAbi as unknown as string[])

      const regHash = await writeContractAsync({
        address: addresses.identityRegistry,
        abi: identAbi,
        functionName: 'register',
        args: [tokenUri],
      })
      const regReceipt = await client.waitForTransactionReceipt({ hash: regHash })

      let aid = 0n
      for (const log of regReceipt.logs) {
        try {
          const decoded = decodeEventLog({ abi: identAbi, data: log.data, topics: log.topics })
          if (decoded.eventName === 'Registered') {
            aid = (decoded.args as any).agentId as bigint
            break
          }
        } catch {}
      }
      if (!aid) throw new Error('Agent registration failed — no event emitted')
      setAgentId(aid.toString())

      // Step 3: Link DID ↔ ERC-8004
      setStep(3)
      const didBytes = encodeAbiParameters([{ type: 'uint128' }], [didIdentifier])
      await writeContractAsync({
        address: addresses.identityRegistry,
        abi: identAbi,
        functionName: 'setMetadata',
        args: [aid, 'codatta:did', didBytes],
      })

      const serviceEndpoint = JSON.stringify({
        id: `did:codatta:${hex}#erc8004`,
        type: 'ERC8004Agent',
        serviceEndpoint: `eip155:31337:${addresses.identityRegistry}#${aid}`,
      })
      await writeContractAsync({
        address: addresses.didRegistry,
        abi: didAbi,
        functionName: 'addItemToAttribute',
        args: [didIdentifier, didIdentifier, 'service', toHex(new TextEncoder().encode(serviceEndpoint))],
      })

      setStep(4)
    } catch (err: any) {
      setError(err.shortMessage || err.message)
    }
  }

  if (!isConnected) {
    return (
      <div>
        <h2>Register Agent</h2>
        <p style={{ color: '#666', marginBottom: 16 }}>Connect your wallet to register as a data service provider.</p>
        <button
          onClick={() => connect({ connector: injected() })}
          style={{ padding: '10px 24px', borderRadius: 8, border: 'none', background: '#4f46e5', color: 'white', fontSize: 14, cursor: 'pointer', fontWeight: 'bold' }}
        >
          Connect Wallet
        </button>
      </div>
    )
  }

  // Done
  if (step === 4) {
    return (
      <div>
        <h2>Agent Registered!</h2>
        <div style={{ padding: 20, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <p><strong>Agent ID:</strong> <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{agentId}</span></p>
          <p><strong>DID:</strong> <Link to={`/did/${didHex}`} style={{ fontFamily: 'monospace' }}>did:codatta:{didHex}</Link></p>
          <p><strong>Name:</strong> {name}</p>
          <p style={{ margin: '12px 0 0', color: '#166534' }}>
            ✅ All three steps completed. DID ↔ ERC-8004 bidirectional linkage established.
          </p>
          <div style={{ marginTop: 16, display: 'flex', gap: 12 }}>
            <Link to={`/agent/${agentId}`} style={linkBtnStyle}>View Agent</Link>
            <Link to={`/did/${didHex}`} style={{ ...linkBtnStyle, background: '#6366f1' }}>View DID</Link>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2>Register Agent</h2>
      <p style={{ color: '#666', marginBottom: 24 }}>
        Register a new Agent with Codatta DID + ERC-8004 identity. Three on-chain transactions will be sent.
      </p>

      {/* Step progress */}
      {step > 0 && (
        <div style={{ marginBottom: 24 }}>
          {STEPS.map((s, i) => {
            const stepNum = i + 1
            const isActive = step === stepNum
            const isDone = step > stepNum
            return (
              <div key={i} style={{
                padding: 14, marginBottom: 8, borderRadius: 8,
                border: `1px solid ${isDone ? '#bbf7d0' : isActive ? '#93c5fd' : '#e5e7eb'}`,
                background: isDone ? '#f0fdf4' : isActive ? '#eff6ff' : '#fafafa',
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                  <span style={{ fontSize: 18 }}>
                    {isDone ? '✅' : isActive ? '⏳' : '⬜'}
                  </span>
                  <div>
                    <strong style={{ fontSize: 14 }}>Step {stepNum}: {s.title}</strong>
                    {isActive && (
                      <p style={{ margin: '6px 0 0', fontSize: 13, color: '#4b5563' }}>{s.description}</p>
                    )}
                    {isDone && stepNum === 1 && didHex && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#166534', fontFamily: 'monospace' }}>
                        did:codatta:{didHex}
                      </p>
                    )}
                    {isDone && stepNum === 2 && agentId && (
                      <p style={{ margin: '4px 0 0', fontSize: 12, color: '#166534', fontFamily: 'monospace' }}>
                        agentId: {agentId.slice(0, 20)}...
                      </p>
                    )}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      )}

      {/* Form */}
      <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
        <label>
          <span style={labelStyle}>Agent Name</span>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} disabled={step > 0} />
        </label>
        <label>
          <span style={labelStyle}>Description</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, height: 80, resize: 'vertical' }} disabled={step > 0} />
        </label>
        <label>
          <span style={labelStyle}>Web Endpoint</span>
          <input value={webEndpoint} onChange={e => setWebEndpoint(e.target.value)} style={inputStyle} disabled={step > 0} />
        </label>

        <button onClick={handleRegister} disabled={step > 0} style={{ ...btnStyle, opacity: step > 0 ? 0.6 : 1 }}>
          {step === 0 ? 'Register Agent (3 transactions)' : 'Processing...'}
        </button>
      </div>

      {error && (
        <div style={{ marginTop: 20, padding: 16, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
          <p style={{ margin: 0, color: '#dc2626' }}>{error}</p>
        </div>
      )}
    </div>
  )
}

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 'bold', marginBottom: 4, color: '#374151' }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #d1d5db', fontSize: 14, boxSizing: 'border-box' }
const btnStyle: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 8, border: 'none',
  background: '#4f46e5', color: 'white', fontSize: 14,
  cursor: 'pointer', fontWeight: 'bold', marginTop: 8,
}
const linkBtnStyle: React.CSSProperties = {
  padding: '8px 16px', borderRadius: 6, background: '#4f46e5',
  color: 'white', textDecoration: 'none', fontSize: 13,
}
