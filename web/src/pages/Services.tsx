import { Link } from 'react-router-dom'
import { useAgentList } from '../hooks/useAgentList'
import { useHiddenAgents } from '../hooks/useHiddenAgents'
import { THEME, styles } from '../lib/theme'

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
  const { hidden } = useHiddenAgents()

  function countAgents(type: string): number {
    if (type === 'annotation') {
      return agents.filter(a => {
        if (hidden.has(a.agentId.toString())) return false
        if (a.registrationFile?.active === false) return false
        const desc = (a.description || '').toLowerCase()
        return desc.includes('annotation') || desc.includes('label') || desc.includes('detection')
      }).length
    }
    return 0
  }

  return (
    <div>
      <h2 style={{ fontSize: 24, fontWeight: 700, marginBottom: 8 }}>Codatta Data Services</h2>
      <p style={{ color: THEME.textSecondary, marginBottom: 24 }}>
        AI-powered data services built on the Codatta data production ecosystem.
        Browse services, discover providers, and integrate via MCP protocol.
      </p>

      <div style={{ display: 'grid', gap: 16 }}>
        {SERVICE_CATALOG.map((svc) => {
          const agentCount = countAgents(svc.type)
          const isAvailable = svc.status === 'available'

          return (
            <div key={svc.type} style={{
              ...styles.card,
              opacity: isAvailable ? 1 : 0.55,
              cursor: isAvailable ? 'pointer' : 'default',
              transition: 'box-shadow 0.2s',
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

      <div style={{ ...styles.card, marginTop: 24, background: THEME.accentBlueLight }}>
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
          <h3 style={{ margin: '0 0 8px', fontSize: 16, fontWeight: 600 }}>{svc.name}</h3>
          <p style={{ margin: 0, fontSize: 13, color: THEME.textSecondary, lineHeight: 1.6 }}>{svc.description}</p>
        </div>
        <span style={{
          ...styles.badge(isAvailable ? THEME.success : THEME.textMuted),
          flexShrink: 0, marginLeft: 12,
        }}>
          {isAvailable ? 'Available' : 'Coming Soon'}
        </span>
      </div>

      <div style={{ display: 'flex', gap: 6, marginTop: 14, flexWrap: 'wrap' }}>
        {svc.taskTypes.map(t => (
          <span key={t} style={{ padding: '3px 10px', borderRadius: 8, fontSize: 11, background: THEME.canvas, color: THEME.textSecondary, fontWeight: 500 }}>
            {t}
          </span>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 20, marginTop: 14, fontSize: 12, color: THEME.textMuted }}>
        <span>Protocol: <strong style={{ color: THEME.textPrimary }}>{svc.protocol}</strong></span>
        {isAvailable && <span>Providers: <strong style={{ color: THEME.textPrimary }}>{agentCount}</strong></span>}
      </div>
    </>
  )
}
