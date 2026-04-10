import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { THEME, styles } from '../lib/theme'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: THEME.textSecondary, fontFamily: 'monospace' }}>
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <button onClick={() => disconnect()} style={styles.btnSecondary}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => connect({ connector: injected() })} style={styles.btnPrimary}>
      Connect Wallet
    </button>
  )
}
