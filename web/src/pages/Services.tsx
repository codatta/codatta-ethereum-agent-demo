import { Link } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'

const SERVICE_CATALOG = [
  {
    type: 'annotation',
    name: 'Data Annotation',
    description: 'Image labeling, object detection, semantic segmentation, and text classification. Powered by AI agents and human annotators through the Codatta data production system.',
    taskTypes: ['Object Detection', 'Segmentation', 'Classification', 'NER'],
    protocol: 'MCP annotate tool',
    status: 'available' as const,
  },
  {
    type: 'validation',
    name: 'Data Validation',
    description: 'Quality assurance for annotated datasets. Cross-validation, accuracy scoring, and consistency checks.',
    taskTypes: ['Annotation QA', 'Data Integrity', 'Format Validation'],
    protocol: 'MCP validate tool',
    status: 'coming-soon' as const,
  },
  {
    type: 'data-access',
    name: 'Data Access',
    description: 'Query and access curated datasets from the Codatta open data platform. On-chain data provenance and fingerprint verification.',
    taskTypes: ['Dataset Query', 'Data Download', 'Provenance Check'],
    protocol: 'MCP / x402',
    status: 'coming-soon' as const,
  },
  {
    type: 'cda-reporter',
    name: 'CDA Reporter',
    description: 'Automated reporting and analytics for on-chain data assets. Generate insights, track data lineage, and produce compliance reports powered by Codatta data intelligence.',
    taskTypes: ['Data Reports', 'Lineage Tracking', 'Compliance Audit'],
    protocol: 'MCP / A2A',
    status: 'coming-soon' as const,
  },
]

export function Services() {
  const { agents } = useAgentList()

  // Count agents per service type (by keyword matching in description)
  function countAgents(type: string): number {
    if (type === 'annotation') {
      return agents.filter(a => {
        const desc = (a.description || '').toLowerCase()
        return desc.includes('annotation') || desc.includes('label') || desc.includes('detection')
      }).length
    }
    return 0
  }

  return (
    <div>
      <h2>Codatta Data Services</h2>
      <p style={{ color: '#666', marginBottom: 24 }}>
        AI-powered data services built on the Codatta data production ecosystem.
        Browse services, discover agents, and integrate via MCP protocol.
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        {SERVICE_CATALOG.map((svc) => {
          const agentCount = countAgents(svc.type)
          const isAvailable = svc.status === 'available'

          return (
            <div key={svc.type} style={{
              ...cardStyle,
              opacity: isAvailable ? 1 : 0.6,
              cursor: isAvailable ? 'pointer' : 'default',
            }}>
              {isAvailable ? (
                <Link to={`/service/${svc.type}`} style={{ textDecoration: 'none', color: 'inherit', display: 'block' }}>
                  <CardContent svc={svc} agentCount={agentCount} />
                </Link>
              ) : (
                <CardContent svc={svc} agentCount={agentCount} />
              )}
            </div>
          )
        })}
      </div>

      <div style={{ marginTop: 32, padding: 16, background: '#f5f3ff', borderRadius: 8 }}>
        <p style={{ margin: 0, fontSize: 13 }}>
          <strong>Want to provide data services?</strong> Connect your wallet and{' '}
          <Link to="/register-agent">register as a Provider</Link>.
        </p>
      </div>
    </div>
  )
}

function CardContent({ svc, agentCount }: { svc: typeof SERVICE_CATALOG[0]; agentCount: number }) {
  const isAvailable = svc.status === 'available'

  return (
    <>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start' }}>
        <div style={{ flex: 1 }}>
          <h3 style={{ margin: '0 0 6px' }}>{svc.name}</h3>
          <p style={{ margin: 0, fontSize: 13, color: '#666', lineHeight: 1.5 }}>{svc.description}</p>
        </div>
        <span style={{
          padding: '2px 10px', borderRadius: 12, fontSize: 12, flexShrink: 0, marginLeft: 12,
          background: isAvailable ? '#dcfce7' : '#f3f4f6',
          color: isAvailable ? '#166534' : '#9ca3af',
        }}>
          {isAvailable ? 'Available' : 'Coming Soon'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 12, flexWrap: 'wrap' }}>
        {svc.taskTypes.map(t => (
          <span key={t} style={{ padding: '2px 8px', borderRadius: 4, fontSize: 11, background: '#f3f4f6', color: '#6b7280' }}>
            {t}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 12, color: '#999' }}>
        <span>Protocol: <strong style={{ color: '#374151' }}>{svc.protocol}</strong></span>
        {isAvailable && <span>Providers: <strong style={{ color: '#374151' }}>{agentCount}</strong></span>}
      </div>
    </>
  )
}

const cardStyle: React.CSSProperties = {
  border: '1px solid #e5e7eb', borderRadius: 8, padding: 20, background: 'white',
}
