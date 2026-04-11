import { useAccount, useSwitchChain } from 'wagmi'
import { appChain } from '../config/wagmi'
import { THEME, styles } from '../lib/theme'

export function NetworkCheck() {
  const { chain, isConnected } = useAccount()
  const { switchChain } = useSwitchChain()

  if (!isConnected) return null
  if (chain?.id === appChain.id) return null

  return (
    <div style={{ ...styles.card, marginBottom: 16, background: 'rgba(239,68,68,0.04)', border: `1px solid ${THEME.danger}30` }}>
      <p style={{ margin: 0, color: THEME.danger, fontWeight: 600 }}>
        Wrong network: {chain?.name || `Chain ${chain?.id}`}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 13, color: THEME.textSecondary }}>
        Please switch to {appChain.name} (Chain ID: {appChain.id}) to interact with contracts.
      </p>
      <button
        onClick={() => switchChain({ chainId: appChain.id })}
        style={{ ...styles.btnPrimary, marginTop: 8, fontSize: 12, padding: '6px 16px' }}
      >
        Switch to {appChain.name}
      </button>
    </div>
  )
}
