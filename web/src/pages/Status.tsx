import { useEffect, useState } from 'react'
import { usePublicClient, useAccount } from 'wagmi'
import { addresses } from '../config/contracts'
import { appChain } from '../config/wagmi'
import { THEME, styles } from '../lib/theme'

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
            chainName: chainId === appChain.id ? appChain.name : `Chain ${chainId}`,
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

  if (!status) return <p style={{ color: THEME.danger }}>Failed to check status.</p>

  return (
    <div>
      <h2>Environment Status</h2>

      {/* Overall */}
      <div style={{
        ...styles.card,
        marginBottom: 24,
        background: status.allReady ? 'rgba(34,197,94,0.06)' : 'rgba(239,68,68,0.04)',
      }}>
        <span style={{ fontSize: 20, marginRight: 8 }}>{status.allReady ? '✅' : '❌'}</span>
        <strong>{status.allReady ? 'Environment Ready' : 'Environment Not Ready'}</strong>
        {!status.allReady && (
          <p style={{ margin: '8px 0 0', fontSize: 13, color: THEME.textSecondary }}>
            {!status.chainConnected
              ? `Cannot connect to chain at ${appChain.rpcUrls.default.http[0]}`
              : 'Some contracts are not deployed. Deploy contracts first.'}
          </p>
        )}
      </div>

      {/* Chain */}
      <section style={styles.section}>
        <h3>Chain</h3>
        <table style={styles.table}>
          <tbody>
            <Row label="Connected" value={status.chainConnected} />
            <Row label="Chain" value={status.chainName} />
            <Row label="Chain ID" value={status.chainId?.toString() || '-'} />
            <Row label="Block Number" value={status.blockNumber?.toString() || '-'} />
            <Row label="RPC" value={appChain.rpcUrls.default.http[0]} />
          </tbody>
        </table>
      </section>

      {/* Wallet */}
      <section style={styles.section}>
        <h3>Wallet</h3>
        <table style={styles.table}>
          <tbody>
            <Row label="Connected" value={status.walletConnected} />
            <Row label="Address" value={status.walletAddress || 'Not connected'} mono />
          </tbody>
        </table>
      </section>

      {/* Contracts */}
      <section style={styles.section}>
        <h3>Deployed Contracts</h3>
        <table style={styles.table}>
          <thead>
            <tr>
              <th style={styles.th}>Contract</th>
              <th style={styles.th}>Address</th>
              <th style={styles.th}>Status</th>
            </tr>
          </thead>
          <tbody>
            {status.contracts.map((c) => (
              <tr key={c.name}>
                <td style={styles.td}>{c.name}</td>
                <td style={{ ...styles.td, ...styles.mono }}>{c.address}</td>
                <td style={styles.td}>
                  <span style={c.hasCode ? styles.badge(THEME.success) : styles.badge(THEME.danger)}>
                    {c.hasCode ? 'Deployed' : 'Not Found'}
                  </span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {/* Config Source */}
      <section style={styles.section}>
        <h3>Configuration</h3>
        <p style={{ fontSize: 13, color: THEME.textSecondary, margin: 0 }}>
          Contract addresses loaded from <code>script/deployment.json</code>
        </p>
      </section>
    </div>
  )
}

function Row({ label, value, mono }: { label: string; value: string | boolean; mono?: boolean }) {
  const display = typeof value === 'boolean'
    ? <span style={{ color: value ? THEME.success : THEME.danger }}>{value ? '✅ Yes' : '❌ No'}</span>
    : <span style={{ fontFamily: mono ? 'monospace' : 'inherit', fontSize: mono ? 12 : 14 }}>{value}</span>

  return (
    <tr>
      <td style={{ ...styles.td, fontWeight: 'bold', width: 140 }}>{label}</td>
      <td style={styles.td}>{display}</td>
    </tr>
  )
}
