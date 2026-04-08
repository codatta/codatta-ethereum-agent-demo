import { Link, Outlet } from 'react-router-dom'
import { ConnectButton } from './ConnectButton'

export function Layout() {
  return (
    <div style={{ maxWidth: 960, margin: '0 auto', padding: '20px' }}>
      <header style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 30, borderBottom: '1px solid #eee', paddingBottom: 15 }}>
        <nav style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <Link to="/" style={{ fontSize: 18, fontWeight: 'bold', textDecoration: 'none', color: '#333' }}>
            Codatta Demo
          </Link>
          <Link to="/" style={navStyle}>Status</Link>
          <Link to="/agents" style={navStyle}>Agents</Link>
          <Link to="/register-agent" style={navStyle}>Register Agent</Link>
          <Link to="/invites" style={navStyle}>Invites</Link>
        </nav>
        <ConnectButton />
      </header>
      <Outlet />
    </div>
  )
}

const navStyle: React.CSSProperties = {
  textDecoration: 'none', color: '#666', fontSize: 14,
}
