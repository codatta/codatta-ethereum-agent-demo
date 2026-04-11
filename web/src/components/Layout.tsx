import { Link, Outlet } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'
import { THEME } from '../lib/theme'

export function Layout() {
  return (
    <div style={{ maxWidth: 1200, margin: '0 auto', padding: '0 24px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '16px 0', borderBottom: THEME.border }}>
        <Link to="/" style={{ fontSize: 18, fontWeight: 700, textDecoration: 'none', color: THEME.textPrimary, letterSpacing: -0.5 }}>
          Codatta
        </Link>
        <ConnectButton />
      </header>

      <div style={{ flex: 1, paddingTop: 32, paddingBottom: 32 }}>
        <Outlet />
      </div>

      <footer style={{ padding: '16px 0', borderTop: THEME.border, fontSize: 14, color: THEME.textMuted, display: 'flex', justifyContent: 'space-between' }}>
        <span>Codatta — AI-Powered Data Services</span>
        <Link to="/status" style={{ color: THEME.textMuted, textDecoration: 'none', fontSize: 14 }}>System Status</Link>
      </footer>
    </div>
  )
}
