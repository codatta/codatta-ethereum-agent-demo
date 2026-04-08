import { useState } from 'react'
import { useAccount, useWriteContract, usePublicClient } from 'wagmi'
import { parseAbi, decodeEventLog, encodeAbiParameters, toHex } from 'viem'
import { addresses, didRegistrarAbi, didRegistryAbi, identityRegistryAbi } from '../config/contracts'

export function RegisterAgent() {
  const { isConnected } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()

  const [name, setName] = useState('My Annotation Agent')
  const [description, setDescription] = useState('AI agent for data annotation services.')
  const [webEndpoint, setWebEndpoint] = useState('http://localhost:4021')

  const [step, setStep] = useState(0) // 0=form, 1=registering DID, 2=registering agent, 3=linking, 4=done
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
      if (!didIdentifier) throw new Error('DID registration failed')
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
      if (!aid) throw new Error('Agent registration failed')
      setAgentId(aid.toString())

      // Step 3: Link DID ↔ ERC-8004
      setStep(3)
      // ERC-8004 → DID
      const didBytes = encodeAbiParameters([{ type: 'uint128' }], [didIdentifier])
      await writeContractAsync({
        address: addresses.identityRegistry,
        abi: identAbi,
        functionName: 'setMetadata',
        args: [aid, 'codatta:did', didBytes],
      })

      // DID → ERC-8004
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
        <p style={{ color: '#ca8a04' }}>Please connect your wallet first.</p>
      </div>
    )
  }

  if (step === 4) {
    return (
      <div>
        <h2>Agent Registered!</h2>
        <div style={{ padding: 16, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
          <p><strong>Agent ID:</strong> <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{agentId}</span></p>
          <p><strong>DID:</strong> <span style={{ fontFamily: 'monospace' }}>did:codatta:{didHex}</span></p>
          <p><strong>Name:</strong> {name}</p>
          <p style={{ margin: 0, color: '#166534' }}>DID ↔ ERC-8004 bidirectional linkage established.</p>
        </div>
      </div>
    )
  }

  return (
    <div>
      <h2>Register Agent</h2>
      <p style={{ color: '#666' }}>Register a new Agent with Codatta DID + ERC-8004 identity.</p>

      <div style={{ display: 'grid', gap: 12, maxWidth: 500 }}>
        <label>
          <span style={labelStyle}>Name</span>
          <input value={name} onChange={e => setName(e.target.value)} style={inputStyle} disabled={step > 0} />
        </label>
        <label>
          <span style={labelStyle}>Description</span>
          <textarea value={description} onChange={e => setDescription(e.target.value)} style={{ ...inputStyle, height: 80 }} disabled={step > 0} />
        </label>
        <label>
          <span style={labelStyle}>Web Endpoint</span>
          <input value={webEndpoint} onChange={e => setWebEndpoint(e.target.value)} style={inputStyle} disabled={step > 0} />
        </label>

        <button onClick={handleRegister} disabled={step > 0} style={{ ...btnStyle, opacity: step > 0 ? 0.6 : 1 }}>
          {step === 0 ? 'Register Agent' :
           step === 1 ? 'Step 1/3: Registering DID...' :
           step === 2 ? 'Step 2/3: Registering Agent...' :
           'Step 3/3: Linking DID ↔ ERC-8004...'}
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

const labelStyle: React.CSSProperties = { display: 'block', fontSize: 13, fontWeight: 'bold', marginBottom: 4 }
const inputStyle: React.CSSProperties = { width: '100%', padding: '8px 12px', borderRadius: 6, border: '1px solid #ddd', fontSize: 14, boxSizing: 'border-box' }
const btnStyle: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 8, border: 'none',
  background: '#4f46e5', color: 'white', fontSize: 14,
  cursor: 'pointer', fontWeight: 'bold',
}
