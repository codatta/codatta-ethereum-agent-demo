import { BrowserRouter, Routes, Route } from 'react-router-dom'
import { Layout } from './components/Layout'
import { Status } from './pages/Status'
import { AgentList } from './pages/AgentList'
import { AgentDetail } from './pages/AgentDetail'
import { DIDDocumentPage } from './pages/DIDDocument'
import { RegisterDID } from './pages/RegisterDID'
import { RegisterAgent } from './pages/RegisterAgent'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<Layout />}>
          <Route path="/" element={<Status />} />
          <Route path="/agents" element={<AgentList />} />
          <Route path="/agent/:agentId" element={<AgentDetail />} />
          <Route path="/did/:identifier" element={<DIDDocumentPage />} />
          <Route path="/register-did" element={<RegisterDID />} />
          <Route path="/register-agent" element={<RegisterAgent />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
