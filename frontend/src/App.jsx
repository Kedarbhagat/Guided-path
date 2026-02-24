import { useLocation } from 'react-router-dom'
import { Routes, Route } from 'react-router-dom'

import GlobalStyle from './components/layout/GlobalStyle'
import Nav from './components/layout/Nav'
import Dashboard from './components/dashboard/Dashboard'
import AnalyticsDashboard from './components/analytics/AnalyticsDashboard'
import FlowBuilder from './components/builder/FlowBuilder'
import AgentExecution from './components/execution/AgentExecution'

export default function App() {
  const location = useLocation()
  const isExecution = location.pathname.startsWith('/execute')

  return (
    <>
      <GlobalStyle />
      <div style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
        {!isExecution && <Nav />}
        <div style={{ flex: 1, overflow: 'hidden' }}>
          <Routes>
            <Route path="/" element={<Dashboard />} />
            <Route path="/analytics" element={<AnalyticsDashboard />} />
            <Route path="/build/:flowId/:versionId" element={<FlowBuilder />} />
            <Route path="/execute/:flowId" element={<AgentExecution />} />
            <Route path="/execute/:flowId/:versionId" element={<AgentExecution />} />
          </Routes>
        </div>
      </div>
    </>
  )
}