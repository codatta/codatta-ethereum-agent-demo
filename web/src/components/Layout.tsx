import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ConnectButton } from './ConnectButton'
import { THEME } from '../lib/theme'

export function Layout() {
  const { pathname } = useLocation()
  const { isConnected } = useAccount()

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto', padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: 32, background: THEME.surface, borderRadius: THEME.radiusCard, padding: '16px 24px', boxShadow: THEME.shadowCard }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/" style={{ fontSize: 20, fontWeight: 700, textDecoration: 'none', color: THEME.textPrimary, letterSpacing: -0.5 }}>
            Codatta
          </Link>
          <ConnectButton />
        </div>
        <nav style={{ display: 'flex', gap: 4, marginTop: 14, alignItems: 'center' }}>
          {isConnected && (
            <>
              <span style={groupLabel}>Provider</span>
              <NavLink to="/dashboard" current={pathname} label="My Agents" />
              <NavLink to="/invites" current={pathname} label="Invites" />
              <NavLink to="/register-agent" current={pathname} label="+ New Agent" />
            </>
          )}
          <div style={{ flex: 1 }} />
          <NavLink to="/status" current={pathname} label="Status" />
        </nav>
      </header>

      <div style={{ flex: 1 }}>
        <Outlet />
      </div>

      <footer style={{ marginTop: 48, paddingTop: 16, fontSize: 12, color: THEME.textMuted, textAlign: 'center' }}>
        Codatta — AI-Powered Data Services
      </footer>
    </div>
  )
}

function NavLink({ to, current, label }: { to: string; current: string; label: string }) {
  const active = current === to || (to !== '/' && current.startsWith(to))
  return (
    <Link to={to} style={{
      textDecoration: 'none', fontSize: 13, padding: '6px 12px', borderRadius: THEME.radiusButton,
      fontWeight: active ? 600 : 400,
      color: active ? THEME.accentBlue : THEME.textSecondary,
      background: active ? THEME.accentBlueLight : 'transparent',
      transition: 'all 0.15s',
    }}>
      {label}
    </Link>
  )
}

const groupLabel: React.CSSProperties = {
  fontSize: 11, color: THEME.textMuted, textTransform: 'uppercase', letterSpacing: 1,
  fontWeight: 500, marginRight: 4,
}
