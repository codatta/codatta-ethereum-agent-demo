import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { usePublicClient, useAccount } from 'wagmi'
import { addresses } from '../config/contracts'
import { anvilLocal } from '../config/wagmi'

interface ContractStatus {
  name: string
  address: string
  hasCode: boolean
}

interface EnvStatus {
  chainConnected: boolean
  chainId: number | null
  chainName: string
  blockNumber: bigint | null
  walletConnected: boolean
  walletAddress: string | null
  contracts: ContractStatus[]
  allReady: boolean
}

export function Status() {
  const client = usePublicClient()
  const { address, isConnected } = useAccount()
  const [status, setStatus] = useState<EnvStatus | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client) {
      setStatus({
        chainConnected: false, chainId: null, chainName: '-',
        blockNumber: null, walletConnected: false, walletAddress: null,
        contracts: [], allReady: false,
      })
      setLoading(false)
      return
    }

    let cancelled = false

    async function check() {
      try {
        setLoading(true)

        // Chain connection
        let chainId: number | null = null
        let blockNumber: bigint | null = null
        let chainConnected = false
        try {
          chainId = await client!.getChainId()
          blockNumber = await client!.getBlockNumber()
          chainConnected = true
        } catch {}

        // Contract deployment check
        const contractList = [
          { name: 'DIDRegistry', address: addresses.didRegistry },
          { name: 'DIDRegistrar', address: addresses.didRegistrar },
          { name: 'IdentityRegistry', address: addresses.identityRegistry },
          { name: 'ReputationRegistry', address: addresses.reputationRegistry },
          { name: 'ValidationRegistry', address: addresses.validationRegistry },
        ]

        const contracts: ContractStatus[] = []
        for (const c of contractList) {
          let hasCode = false
          try {
            const code = await client!.getCode({ address: c.address as `0x${string}` })
            hasCode = !!code && code !== '0x'
          } catch {}
          contracts.push({ name: c.name, address: c.address, hasCode })
        }

        const allReady = chainConnected && contracts.every(c => c.hasCode)

        if (!cancelled) {
          setStatus({
            chainConnected, chainId,
            chainName: chainId === anvilLocal.id ? 'Anvil Local' : `Chain ${chainId}`,
            blockNumber,
            walletConnected: isConnected,
            walletAddress: address || null,
            contracts, allReady,
          })
        }
      } catch {
        if (!cancelled) setStatus(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    check()
    return () => { cancelled = true }
  }, [client, isConnected, address])

  if (loading) return <p>Checking environment...</p>

  if (!status) return <p style={{ color: 'red' }}>Failed to check status.</p>

  return (
    <div>
      <h2>Environment Status</h2>

      {/* Overall */}
      <div style={{
        padding: 16, borderRadius: 8, marginBottom: 24,
        background: status.allReady ? '#f0fdf4' : '#fef2f2',
        border: `1px solid ${status.allReady ? '#bbf7d0' : '#fecaca'}`,
      }}>
        <span style={{ fontSize: 20, marginRight: 8 }}>{status.allReady ? '✅' : '❌'}</span>
        <strong>{status.allReady ? 'Environment Ready' : 'Environment Not Ready'}</strong>
        {!status.allReady && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: '#666' }}>
            {!status.chainConnected
              ? 'Cannot connect to chain. Is Anvil running? (anvil --block-time 1)'
              : 'Some contracts are not deployed. Run: forge script script/Deploy.s.sol:Deploy --rpc-url http://127.0.0.1:8545 --broadcast'}
          </p>
        )}
      </div>

      {/* Quick Navigation */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 24 }}>
        <Link to="/services" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', background: '#fafafa' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>🔍</div>
            <h3 style={{ margin: '0 0 4px' }}>I'm a Client</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
              Browse data annotation services, compare agents, learn how to use MCP/A2A
            </p>
          </div>
        </Link>
        <Link to="/dashboard" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div style={{ padding: 20, border: '1px solid #e5e7eb', borderRadius: 8, cursor: 'pointer', background: '#fafafa' }}>
            <div style={{ fontSize: 24, marginBottom: 8 }}>⚙️</div>
            <h3 style={{ margin: '0 0 4px' }}>I'm a Provider</h3>
            <p style={{ margin: 0, fontSize: 13, color: '#666' }}>
              Manage your agents, view service records, track invites and reputation
            </p>
          </div>
        </Link>
      </div>

      {/* Chain */}
      <section style={sectionStyle}>
        <h3>Chain</h3>
        <table style={tableStyle}>
          <tbody>
            <Row label="Connected" value={status.chainConnected} />
            <Row label="Chain" value={status.chainName} />
            <Row label="Chain ID" value={status.chainId?.toString() || '-'} />
            <Row label="Block Number" value={status.blockNumber?.toString() || '-'} />
            <Row label="RPC" value={anvilLocal.rpcUrls.default.http[0]} />
          </tbody>
        </table>
      </section>

      {/* Wallet */}
      <section style={sectionStyle}>
        <h3>Wallet</h3>
        <table style={tableStyle}>
          <tbody>
            <Row label="Connected" value={status.walletConnected} />
            <Row label="Address" value={status.walletAddress || 'Not connected'} mono />
          </tbody>
        </table>
      </section>

      {/* Contracts */}
      <section style={sectionStyle}>
        <h3>Deployed Contracts</h3>
        <table style={tableStyle}>
          <thead>
            <tr>
              <th style={thStyle}>Contract</th>
              <th style={thStyle}>Address</th>
              <th style={thStyle}>Status</th>
            </tr>
          </thead>
          <tbody>
            {status.contracts.map((c) => (
              <tr key={c.name}>
                <td style={tdStyle}>{c.name}</td>
                <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: 12 }}>{c.address}</td>
                <td style={tdStyle}>
                  <span style={{
                    padding: '2px 8px', borderRadius: 12, fontSize: 12,
                    background: c.hasCode ? '#dcfce7' : '#fef2f2',
                    color: c.hasCode ? '#166534' : '#dc2626',
                  }}>
                    {c.hasCode ? 'Deployed' : 'Not Found'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Config Source */}
      <section style={sectionStyle}>
        <h3>Configuration</h3>
        <p style={{ fontSize: 13, color: '#666', margin: 0 }}>
          Contract addresses loaded from <code>script/deployment.json</code>
        </p>
      </section>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string | boolean; mono?: boolean }) {
  const display = typeof value === 'boolean'
    ? <span style={{ color: value ? '#166534' : '#dc2626' }}>{value ? '✅ Yes' : '❌ No'}</span>
    : <span style={{ fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 12 : 14 }}>{value}</span>

  return (
    <tr>
      <td style={{ ...tdStyle, fontWeight: 'bold', width: 140 }}>{label}</td>
      <td style={tdStyle}>{display}</td>
    </tr>
  )
}

const sectionStyle: React.CSSProperties = { marginBottom: 20, border: '1px solid #e5e7eb', borderRadius: 8, padding: 16 }
const tableStyle: React.CSSProperties = { width: '100%', borderCollapse: 'collapse' }
const thStyle: React.CSSProperties = { textAlign: 'left', padding: '6px 10px', borderBottom: '1px solid #eee', fontSize: 12, color: '#999' }
const tdStyle: React.CSSProperties = { padding: '6px 10px', borderBottom: '1px solid #f5f5f5', fontSize: 14 }
