import { useMemo, useState } from 'react'
import { useAccount } from 'wagmi'
import { THEME, styles } from '../lib/theme'
import { useTasks, transitionTask, type AsyncTask, type TaskStatus } from '../hooks/useTasks'

const STATUS_COLOR: Record<TaskStatus, string> = {
  pending: THEME.danger,       // attention-worthy
  accepted: THEME.teal,
  working: THEME.blue,
  completed: THEME.success,
  failed: THEME.danger,
  cancelled: THEME.textMuted,
}

type FilterKey = 'open' | 'all' | TaskStatus

const FILTERS: Array<{ key: FilterKey; label: string; statuses: TaskStatus[] | null }> = [
  { key: 'open', label: 'Open', statuses: ['pending', 'accepted', 'working'] },
  { key: 'pending', label: 'Pending', statuses: ['pending'] },
  { key: 'accepted', label: 'Accepted', statuses: ['accepted'] },
  { key: 'working', label: 'Working', statuses: ['working'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'failed', label: 'Failed', statuses: ['failed'] },
  { key: 'cancelled', label: 'Cancelled', statuses: ['cancelled'] },
  { key: 'all', label: 'All', statuses: null },
]

export function Tasks() {
  const { address, isConnected } = useAccount()
  const [filter, setFilter] = useState<FilterKey>('open')
  const [busy, setBusy] = useState<string | null>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const statusQuery = useMemo(() => {
    const f = FILTERS.find(x => x.key === filter)!
    return f.statuses ? f.statuses.join(',') : undefined
  }, [filter])

  const { data, error, reload } = useTasks(address, { status: statusQuery }, 4000)

  async function runAction(task: AsyncTask, action: 'accept' | 'work' | 'complete' | 'fail' | 'cancel') {
    setBusy(task.id)
    setActionError(null)
    try {
      let body: Record<string, unknown> = {}
      if (action === 'complete') {
        const resultStr = window.prompt('Result (JSON or plain text, optional):', '')
        if (resultStr == null) { setBusy(null); return }
        body.result = parseResultInput(resultStr)
      } else if (action === 'fail') {
        const reason = window.prompt('Reason (optional):', '') || 'failed'
        body.error = reason
      } else if (action === 'cancel') {
        const confirmed = window.confirm('Cancel this task?')
        if (!confirmed) { setBusy(null); return }
      }
      await transitionTask(task.id, action, body)
      await reload()
    } catch (err: any) {
      setActionError(err.message || String(err))
    } finally {
      setBusy(null)
    }
  }

  if (!isConnected) {
    return (
      <div>
        <h2>Tasks</h2>
        <p style={{ color: THEME.danger }}>Connect your wallet to view your async task inbox.</p>
      </div>
    )
  }

  const counts = data?.counts
  const tasks = data?.tasks || []

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8 }}>
        <h2 style={{ margin: 0 }}>Async Task Inbox</h2>
        <button onClick={reload} style={styles.btnSecondary}>Refresh</button>
      </div>
      <p style={{ color: THEME.textMuted, marginTop: 0, fontSize: 13 }}>
        Tasks submitted to your provider agents via the async framework. Accept / work / complete to move them through the state machine.
      </p>

      {error && <p style={{ color: THEME.danger }}>Error loading tasks: {error}</p>}
      {actionError && <p style={{ color: THEME.danger }}>Action failed: {actionError}</p>}

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        {FILTERS.map(f => {
          const count = counts ? sumCounts(counts, f.statuses) : 0
          return (
            <FilterBtn
              key={f.key}
              label={f.label}
              active={filter === f.key}
              count={count}
              onClick={() => setFilter(f.key)}
            />
          )
        })}
      </div>

      {tasks.length === 0 ? (
        <div style={{ ...styles.card, textAlign: 'center' }}>
          <p style={{ color: THEME.textMuted, margin: 0 }}>No tasks in this bucket.</p>
        </div>
      ) : (
        <div style={{ display: 'grid', gap: 12 }}>
          {tasks.map(task => (
            <TaskCard
              key={task.id}
              task={task}
              busy={busy === task.id}
              expanded={expandedId === task.id}
              onToggle={() => setExpandedId(expandedId === task.id ? null : task.id)}
              onAction={(action) => runAction(task, action)}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function TaskCard({ task, busy, expanded, onToggle, onAction }: {
  task: AsyncTask
  busy: boolean
  expanded: boolean
  onToggle: () => void
  onAction: (a: 'accept' | 'work' | 'complete' | 'fail' | 'cancel') => void
}) {
  const actions = availableActions(task.status)
  const age = formatAge(task.createdAt)
  return (
    <div style={styles.card}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
            <span style={styles.badge(STATUS_COLOR[task.status])}>{task.status}</span>
            <strong>{task.serviceName}</strong>
            <span style={{ ...styles.mono, fontSize: 12, color: THEME.textMuted }}>{task.id}</span>
          </div>
          <div style={{ marginTop: 6, fontSize: 12, color: THEME.textSecondary }}>
            From: <span style={styles.mono}>{shortAddr(task.clientAddress)}</span>
            {task.clientDid && <> · <span style={styles.mono}>{task.clientDid}</span></>}
            <> · {age}</>
            {task.agentId && <> · agentId <span style={styles.mono}>{task.agentId}</span></>}
          </div>
          {task.note && <div style={{ marginTop: 6, fontSize: 13, color: THEME.textSecondary }}>Note: {task.note}</div>}
          {task.error && <div style={{ marginTop: 6, fontSize: 13, color: THEME.danger }}>Error: {task.error}</div>}
        </div>
        <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
          {actions.map(a => (
            <button
              key={a}
              onClick={() => onAction(a)}
              disabled={busy}
              style={actionStyle(a, busy)}
            >
              {actionLabel(a)}
            </button>
          ))}
        </div>
      </div>

      <div style={{ marginTop: 10 }}>
        <button
          onClick={onToggle}
          style={{ background: 'none', border: 'none', cursor: 'pointer', color: THEME.blue, fontSize: 12, padding: 0 }}
        >
          {expanded ? 'Hide payload' : 'Show payload / result'}
        </button>
        {expanded && (
          <div style={{ marginTop: 8, display: 'grid', gap: 8 }}>
            <JsonBlock label="payload" value={task.payload} />
            {task.result != null && <JsonBlock label="result" value={task.result} />}
            <TimestampRow task={task} />
          </div>
        )}
      </div>
    </div>
  )
}

function JsonBlock({ label, value }: { label: string; value: unknown }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: THEME.textMuted, marginBottom: 2 }}>{label}</div>
      <pre style={{ ...styles.code, margin: 0, maxHeight: 200 }}>{safeStringify(value)}</pre>
    </div>
  )
}

function TimestampRow({ task }: { task: AsyncTask }) {
  const entries: Array<[string, string | null]> = [
    ['created', task.createdAt],
    ['accepted', task.acceptedAt],
    ['started', task.startedAt],
    ['completed', task.completedAt],
  ]
  return (
    <div style={{ fontSize: 11, color: THEME.textMuted, display: 'flex', gap: 12, flexWrap: 'wrap' }}>
      {entries.filter(([, v]) => !!v).map(([k, v]) => (
        <span key={k}>{k}: {new Date(v as string).toLocaleTimeString()}</span>
      ))}
    </div>
  )
}

function FilterBtn({ label, active, count, onClick }: { label: string; active: boolean; count: number; onClick: () => void }) {
  return (
    <button onClick={onClick} style={{
      padding: '6px 14px', borderRadius: THEME.radiusButton, border: 'none', cursor: 'pointer',
      fontSize: 13, fontWeight: active ? 600 : 400,
      background: active ? THEME.blue : 'rgba(0,0,0,0.05)',
      color: active ? '#ffffff' : THEME.textSecondary,
    }}>
      {label} ({count})
    </button>
  )
}

// ── helpers ──────────────────────────────────────────────────────

function availableActions(status: TaskStatus): Array<'accept' | 'work' | 'complete' | 'fail' | 'cancel'> {
  switch (status) {
    case 'pending': return ['accept', 'fail', 'cancel']
    case 'accepted': return ['work', 'complete', 'fail', 'cancel']
    case 'working': return ['complete', 'fail', 'cancel']
    default: return []
  }
}

function actionLabel(a: string): string {
  return a.charAt(0).toUpperCase() + a.slice(1)
}

function actionStyle(a: string, busy: boolean): React.CSSProperties {
  const base: React.CSSProperties = {
    padding: '6px 12px',
    borderRadius: THEME.radiusButton,
    border: '1px solid transparent',
    fontSize: 13,
    fontWeight: 500,
    cursor: busy ? 'wait' : 'pointer',
    opacity: busy ? 0.6 : 1,
  }
  if (a === 'complete') return { ...base, background: THEME.success, color: '#fff' }
  if (a === 'fail' || a === 'cancel') return { ...base, background: 'rgba(221,91,0,0.1)', color: THEME.danger }
  if (a === 'accept' || a === 'work') return { ...base, background: THEME.blue, color: '#fff' }
  return base
}

function sumCounts(counts: Record<TaskStatus, number>, statuses: TaskStatus[] | null): number {
  if (!statuses) return Object.values(counts).reduce((a, b) => a + b, 0)
  return statuses.reduce((sum, s) => sum + (counts[s] || 0), 0)
}

function shortAddr(addr: string): string {
  if (!addr) return '(unknown)'
  if (addr.length < 14) return addr
  return `${addr.slice(0, 6)}...${addr.slice(-4)}`
}

function formatAge(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const s = Math.floor(diff / 1000)
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return new Date(iso).toLocaleString()
}

function safeStringify(value: unknown): string {
  try { return JSON.stringify(value, null, 2) }
  catch { return String(value) }
}

function parseResultInput(raw: string): unknown {
  const trimmed = raw.trim()
  if (trimmed === '') return null
  try { return JSON.parse(trimmed) }
  catch { return trimmed }
}
