import { useAccount, useSwitchChain } from 'wagmi'
import { appChain } from '../config/wagmi'
import { THEME, styles } from '../lib/theme'
import { ENV } from '../config/env'

async function addAndSwitchNetwork() {
  const provider = (window as any).ethereum
  if (!provider) return

  try {
    // Try switching first
    await provider.request({
      method: 'wallet_switchEthereumChain',
      params: [{ chainId: `0x${ENV.CHAIN_ID.toString(16)}` }],
    })
  } catch (switchError: any) {
    // Chain not added yet — add it
    if (switchError.code === 4902) {
      await provider.request({
        method: 'wallet_addEthereumChain',
        params: [{
          chainId: `0x${ENV.CHAIN_ID.toString(16)}`,
          chainName: ENV.CHAIN_NAME,
          nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
          rpcUrls: [ENV.RPC_URL],
        }],
      })
    }
  }
}

export function NetworkCheck() {
  const { chain, isConnected } = useAccount()

  if (!isConnected) return null
  if (chain?.id === appChain.id) return null

  return (
    <div style={{ ...styles.card, marginBottom: 16, background: 'rgba(221,91,0,0.04)', border: `1px solid ${THEME.danger}30` }}>
      <p style={{ margin: 0, color: THEME.danger, fontWeight: 600 }}>
        Wrong network: {chain?.name || `Chain ${chain?.id}`}
      </p>
      <p style={{ margin: '4px 0 0', fontSize: 14, color: THEME.textSecondary }}>
        Please switch to {appChain.name} (Chain ID: {appChain.id}).
      </p>
      <button
        onClick={addAndSwitchNetwork}
        style={{ ...styles.btnPrimary, marginTop: 8 }}
      >
        Switch to {appChain.name}
      </button>
    </div>
  )
}
