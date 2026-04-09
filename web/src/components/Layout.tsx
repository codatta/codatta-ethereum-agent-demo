import { Link, Outlet, useLocation } from 'react-router-dom'
import { useAccount } from 'wagmi'
import { ConnectButton } from './ConnectButton'

export function Layout() {
  const { pathname } = useLocation()
  const { isConnected } = useAccount()

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px', minHeight: '100vh', display: 'flex', flexDirection: 'column' }}>
      <header style={{ marginBottom: 30, borderBottom: '1px solid #eee', paddingBottom: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/" style={{ fontSize: 18, fontWeight: 'bold', textDecoration: 'none', color: '#333' }}>
            Codatta
          </Link>
          <ConnectButton />
        </div>
        <nav style={{ display: 'flex', gap: 6, marginTop: 12, alignItems: 'center' }}>
          <NavLink to="/" current={pathname} label="Services" />
          {isConnected && (
            <>
              <Sep />
              <span style={groupLabel}>Provider</span>
              <NavLink to="/dashboard" current={pathname} label="Dashboard" />
              <NavLink to="/invites" current={pathname} label="Invites" />
              <NavLink to="/register-agent" current={pathname} label="Register" />
            </>
          )}
          <div style={{ flex: 1 }} />
          <NavLink to="/status" current={pathname} label="Status" />
        </nav>
      </header>

      <div style={{ flex: 1 }}>
        <Outlet />
      </div>

      <footer style={{ marginTop: 40, paddingTop: 16, borderTop: '1px solid #f0f0f0', fontSize: 12, color: '#999' }}>
        Codatta Demo — Codatta DID × ERC-8004 × MCP
      </footer>
    </div>
  )
}

function NavLink({ to, current, label }: { to: string; current: string; label: string }) {
  const active = current === to || (to !== '/' && current.startsWith(to))
  return (
    <Link to={to} style={{
      textDecoration: 'none', fontSize: 13, padding: '4px 10px', borderRadius: 6,
      color: active ? '#4f46e5' : '#666',
      background: active ? '#eef2ff' : 'transparent',
    }}>
      {label}
    </Link>
  )
}

function Sep() {
  return <span style={{ color: '#ddd', margin: '0 4px' }}>|</span>
}

const groupLabel: React.CSSProperties = {
  fontSize: 11, color: '#999', textTransform: 'uppercase', letterSpacing: 1,
  alignSelf: 'center', marginRight: 2,
}
