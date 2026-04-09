import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Services } from './pages/Services'
import { AgentDetail } from './pages/AgentDetail'
import { Guide } from './pages/Guide'
import { ProviderDashboard } from './pages/ProviderDashboard'
import { Invites } from './pages/Invites'
import { RegisterAgent } from './pages/RegisterAgent'
import { DIDDocumentPage } from './pages/DIDDocument'
import { Status } from './pages/Status'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Client (default) */}
          <Route path="/" element={<Services />} />
          <Route path="/agent/:agentId" element={<AgentDetail />} />
          <Route path="/guide" element={<Guide />} />
          {/* Provider (requires wallet) */}
          <Route path="/dashboard" element={<ProviderDashboard />} />
          <Route path="/invites" element={<Invites />} />
          <Route path="/register-agent" element={<RegisterAgent />} />
          {/* Shared */}
          <Route path="/did/:identifier" element={<DIDDocumentPage />} />
          <Route path="/status" element={<Status />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
