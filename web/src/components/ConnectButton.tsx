import { useState, useRef, useEffect } from 'react'
import { useAccount, useConnect, useDisconnect } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { THEME, styles } from '../lib/theme'

export function ConnectButton() {
  const { address, isConnected } = useAccount()
  const { connect } = useConnect()
  const { disconnect } = useDisconnect()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function handleClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handleClick)
    return () => document.removeEventListener('mousedown', handleClick)
  }, [])

  if (!isConnected) {
    return (
      <button onClick={() => connect({ connector: injected() })} style={styles.btnPrimary}>
        Connect Wallet
      </button>
    )
  }

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: 10 }}>
      <span style={{ fontSize: 14, color: THEME.textSecondary, fontFamily: 'monospace' }}>
        {address?.slice(0, 6)}...{address?.slice(-4)}
      </span>

      <div
        onClick={() => setOpen(!open)}
        style={{
          width: 32, height: 32, borderRadius: '50%',
          background: THEME.blue, cursor: 'pointer',
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 13, fontWeight: 600,
        }}
      >
        {address?.slice(2, 4).toUpperCase()}
      </div>

      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 40, width: 220,
          background: THEME.surface, borderRadius: THEME.radiusCard,
          border: THEME.border, boxShadow: THEME.shadowDeep, zIndex: 100,
        }}>
          <MenuItem href="/dashboard" label="My Agents" onClick={() => setOpen(false)} />
          <MenuItem href="/invites" label="Invites" onClick={() => setOpen(false)} />
          <div style={{ borderTop: THEME.border }} />
          <div
            onClick={() => { disconnect(); setOpen(false) }}
            style={{ ...menuStyle, color: THEME.danger }}
          >
            Disconnect
          </div>
        </div>
      )}
    </div>
  )
}

function MenuItem({ href, label, onClick }: { href: string; label: string; onClick: () => void }) {
  return (
    <a href={href} onClick={onClick} style={{ ...menuStyle, textDecoration: 'none', display: 'block' }}>
      {label}
    </a>
  )
}

const menuStyle: React.CSSProperties = {
  padding: '10px 14px', fontSize: 14, fontWeight: 500,
  color: THEME.textPrimary, cursor: 'pointer',
}
