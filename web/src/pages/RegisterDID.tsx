import { useState } from 'react'
import { useAccount, useWriteContract, useWaitForTransactionReceipt } from 'wagmi'
import { parseAbi, decodeEventLog } from 'viem'
import { addresses, didRegistrarAbi, didRegistryAbi } from '../config/contracts'
import { usePublicClient } from 'wagmi'

export function RegisterDID() {
  const { isConnected } = useAccount()
  const client = usePublicClient()
  const { writeContractAsync } = useWriteContract()
  const [didHex, setDidHex] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  async function handleRegister() {
    if (!client) return
    setLoading(true)
    setError(null)
    setDidHex(null)

    try {
      const hash = await writeContractAsync({
        address: addresses.didRegistrar,
        abi: parseAbi(didRegistrarAbi as unknown as string[]),
        functionName: 'register',
      })

      const receipt = await client.waitForTransactionReceipt({ hash })

      // Find DIDRegistered event
      const abi = parseAbi(didRegistryAbi as unknown as string[])
      for (const log of receipt.logs) {
        try {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
          if (decoded.eventName === 'DIDRegistered') {
            const identifier = (decoded.args as any).identifier as bigint
            setDidHex(identifier.toString(16))
            break
          }
        } catch {}
      }
    } catch (err: any) {
      setError(err.shortMessage || err.message)
    } finally {
      setLoading(false)
    }
  }

  return (
    <div>
      <h2>Register Codatta DID</h2>
      <p style={{ color: '#666' }}>Register a new Codatta DID on-chain. Free, one-click.</p>

      {!isConnected ? (
        <p style={{ color: '#ca8a04' }}>Please connect your wallet first.</p>
      ) : (
        <div>
          <button
            onClick={handleRegister}
            disabled={loading}
            style={{ ...btnStyle, opacity: loading ? 0.6 : 1 }}
          >
            {loading ? 'Registering...' : 'Register DID'}
          </button>

          {didHex && (
            <div style={{ marginTop: 20, padding: 16, background: '#f0fdf4', borderRadius: 8, border: '1px solid #bbf7d0' }}>
              <p style={{ margin: 0, fontWeight: 'bold', color: '#166534' }}>DID Registered!</p>
              <p style={{ margin: '8px 0 0', fontFamily: 'monospace', fontSize: 14 }}>
                did:codatta:{didHex}
              </p>
            </div>
          )}

          {error && (
            <div style={{ marginTop: 20, padding: 16, background: '#fef2f2', borderRadius: 8, border: '1px solid #fecaca' }}>
              <p style={{ margin: 0, color: '#dc2626' }}>{error}</p>
            </div>
          )}
        </div>
      )}
    </div>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '10px 24px', borderRadius: 8, border: 'none',
  background: '#4f46e5', color: 'white', fontSize: 14,
  cursor: 'pointer', fontWeight: 'bold',
}
