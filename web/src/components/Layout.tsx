import { Link, Outlet, useLocation } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'
import { THEME } from '../lib/theme'

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto', padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: 32, background: THEME.surface, borderRadius: THEME.radiusCard, padding: '16px 24px', boxShadow: THEME.shadowCard }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 24 }}>
            <Link to="/" style={{ fontSize: 20, fontWeight: 700, textDecoration: 'none', color: THEME.textPrimary, letterSpacing: -0.5 }}>
              Codatta
            </Link>
            <NavLink to="/status" current={pathname} label="Status" />
          </div>
          <ConnectButton />
        </div>
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
  const active = current === to
  return (
    <Link to={to} style={{
      textDecoration: 'none', fontSize: 13, padding: '6px 12px', borderRadius: THEME.radiusButton,
      fontWeight: active ? 600 : 400,
      color: active ? THEME.accentBlue : THEME.textSecondary,
      background: active ? THEME.accentBlueLight : 'transparent',
    }}>
      {label}
    </Link>
  )
}
