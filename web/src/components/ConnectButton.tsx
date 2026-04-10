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

  // Close dropdown on outside click
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
    <div ref={ref} style={{ position: 'relative' }}>
      {/* Avatar */}
      <div
        onClick={() => setOpen(!open)}
        style={{
          width: 36, height: 36, borderRadius: '50%',
          background: `linear-gradient(135deg, ${THEME.accentBlue}, ${THEME.accentOrange})`,
          cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
          color: 'white', fontSize: 14, fontWeight: 600,
        }}
      >
        {address?.slice(2, 4).toUpperCase()}
      </div>

      {/* Dropdown */}
      {open && (
        <div style={{
          position: 'absolute', right: 0, top: 44, width: 260,
          background: THEME.surface, borderRadius: THEME.radiusCard,
          boxShadow: '0 8px 30px rgba(0,0,0,0.12)', zIndex: 100,
          overflow: 'hidden',
        }}>
          {/* Wallet info */}
          <div style={{ padding: '16px 16px 12px', borderBottom: '1px solid #F3F4F6' }}>
            <div style={{ fontSize: 12, color: THEME.textMuted, marginBottom: 4 }}>Wallet</div>
            <div style={{ fontFamily: 'monospace', fontSize: 13, color: THEME.textPrimary, wordBreak: 'break-all' }}>
              {address}
            </div>
          </div>

          {/* Menu items */}
          <MenuItem href="/dashboard" label="My Agents" onClick={() => setOpen(false)} />
          <MenuItem href="/invites" label="Invites" onClick={() => setOpen(false)} />
          <MenuItem href="/register-agent" label="+ New Agent" onClick={() => setOpen(false)} />

          {/* Disconnect */}
          <div
            onClick={() => { disconnect(); setOpen(false); }}
            style={{ ...menuItemStyle, color: THEME.danger, borderTop: '1px solid #F3F4F6' }}
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
    <a href={href} onClick={onClick} style={{ ...menuItemStyle, textDecoration: 'none', display: 'block' }}>
      {label}
    </a>
  )
}

const menuItemStyle: React.CSSProperties = {
  padding: '10px 16px', fontSize: 13, color: THEME.textPrimary,
  cursor: 'pointer', transition: 'background 0.1s',
}
