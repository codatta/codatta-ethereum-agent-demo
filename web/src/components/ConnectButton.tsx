import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()

  if (isConnected) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
        <span style={{ fontSize: 13, color: '#666', fontFamily: 'monospace' }}>
          {address?.slice(0, 6)}...{address?.slice(-4)}
        </span>
        <button onClick={() => disconnect()} style={btnStyle}>
          Disconnect
        </button>
      </div>
    )
  }

  return (
    <button onClick={() => connect({ connector: injected() })} style={{ ...btnStyle, background: '#4f46e5', color: 'white' }}>
      Connect Wallet
    </button>
  )
}

const btnStyle: React.CSSProperties = {
  padding: '6px 14px', borderRadius: 6, border: '1px solid #ddd',
  cursor: 'pointer', fontSize: 13, background: 'white',
}
