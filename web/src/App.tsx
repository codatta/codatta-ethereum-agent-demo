import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Services } from './pages/Services'
import { ServiceDetail } from './pages/ServiceDetail'
import { AgentDetail } from './pages/AgentDetail'
import { Bazaar } from './pages/Bazaar'
import { ProviderDashboard } from './pages/ProviderDashboard'
import { Invites } from './pages/Invites'
import { RegisterAgent } from './pages/RegisterAgent'
import { DIDDocumentPage } from './pages/DIDDocument'
import { Status } from './pages/Status'
import { Tasks } from './pages/Tasks'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          {/* Client */}
          <Route path="/" element={<Services />} />
          <Route path="/service/:type" element={<ServiceDetail />} />
          <Route path="/agent/:agentId" element={<AgentDetail />} />
          <Route path="/bazaar" element={<Bazaar />} />
          {/* Provider */}
          <Route path="/dashboard" element={<ProviderDashboard />} />
          <Route path="/invites" element={<Invites />} />
          <Route path="/tasks" element={<Tasks />} />
          <Route path="/register-agent" element={<RegisterAgent />} />
          {/* Shared */}
          <Route path="/did/:identifier" element={<DIDDocumentPage />} />
          <Route path="/status" element={<Status />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
