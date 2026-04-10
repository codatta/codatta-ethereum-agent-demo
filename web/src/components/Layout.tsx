import { Link, Outlet } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'
import { THEME } from '../lib/theme'

export function Layout() {

  return (
    <div style={{ maxWidth: 1024, margin: '0 auto', padding: '24px 20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: 32, background: THEME.surface, borderRadius: THEME.radiusCard, padding: '16px 24px', boxShadow: THEME.shadowCard }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/" style={{ fontSize: 20, fontWeight: 700, textDecoration: 'none', color: THEME.textPrimary, letterSpacing: -0.5 }}>
            Codatta
          </Link>
          <ConnectButton />
        </div>
      </header>

      <div style={{ flex: 1 }}>
        <Outlet />
      </div>

      <footer style={{ marginTop: 48, paddingTop: 16, fontSize: 12, color: THEME.textMuted, display: 'flex', justifyContent: 'space-between' }}>
        <span>Codatta — AI-Powered Data Services</span>
        <Link to="/status" style={{ color: THEME.textMuted, textDecoration: 'none' }}>System Status</Link>
      </footer>
    </div>
  )
}
