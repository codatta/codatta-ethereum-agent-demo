import { Link, Outlet, useLocation } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'

export function Layout() {
  const { pathname } = useLocation()

  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px' }}>
      <header style={{ marginBottom: 30, borderBottom: '1px solid #eee', paddingBottom: 15 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
          <Link to="/" style={{ fontSize: 18, fontWeight: 'bold', textDecoration: 'none', color: '#333' }}>
            Codatta Demo
          </Link>
          <ConnectButton />
        </div>
        <nav style={{ display: 'flex', gap: 6, marginTop: 12 }}>
          <NavLink to="/" current={pathname} label="Status" />
          <Sep />
          <span style={groupLabel}>Client</span>
          <NavLink to="/services" current={pathname} label="Services" />
          <NavLink to="/guide" current={pathname} label="Guide" />
          <Sep />
          <span style={groupLabel}>Provider</span>
          <NavLink to="/dashboard" current={pathname} label="Dashboard" />
          <NavLink to="/invites" current={pathname} label="Invites" />
          <NavLink to="/register-agent" current={pathname} label="Register" />
        </nav>
      </header>
      <Outlet />
    </div>
  )
}

function NavLink({ to, current, label }: { to: string; current: string; label: string }) {
  const active = current === to
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
