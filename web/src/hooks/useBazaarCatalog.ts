import { useEffect, useState } from 'react'
import type { AgentSummary } from './useAgentList'

export interface BazaarItem {
  resource: string
  type: 'http' | 'mcp' | string
  description?: string
  accepts: Array<Record<string, unknown>>
  bazaar?: {
    info?: Record<string, unknown>
    schema?: Record<string, unknown>
    [k: string]: unknown
  }
}

export type ProviderStatus = 'loading' | 'ok' | 'unreachable' | 'no-web'

export interface ProviderCatalog {
  key: string
  name: string
  description: string
  link: string
  webEndpoint: string | null
  status: ProviderStatus
  items: BazaarItem[]
  error?: string
}

function getWebEndpoint(a: AgentSummary): string | null {
  const fromReg = a.registrationFile?.services?.find(s => s.name === 'web')?.endpoint
  if (fromReg) return fromReg
  return a.didMeta?.webEndpoint ?? null
}

function isActive(a: AgentSummary): boolean {
  if (a.agentId) return a.registrationFile?.active !== false
  return a.didMeta?.active !== false
}

function agentLink(a: AgentSummary): string {
  if (a.agentId) return `/agent/${a.agentId.toString()}`
  return `/did/0x${a.didHex}`
}

function agentKey(a: AgentSummary): string {
  return a.agentId ? `agent:${a.agentId}` : `did:${a.didHex}`
}

export function useBazaarCatalog(agents: AgentSummary[]) {
  const [providers, setProviders] = useState<ProviderCatalog[]>([])
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    let cancelled = false

    async function run() {
      const candidates = agents.filter(isActive).map((a): ProviderCatalog => {
        const webEndpoint = getWebEndpoint(a)
        return {
          key: agentKey(a),
          name: a.name,
          description: a.description,
          link: agentLink(a),
          webEndpoint,
          status: webEndpoint ? 'loading' : 'no-web',
          items: [],
        }
      })

      if (cancelled) return
      setProviders(candidates)
      setLoading(true)

      const settled = await Promise.all(candidates.map(async (p): Promise<ProviderCatalog> => {
        if (!p.webEndpoint) return p
        const url = p.webEndpoint.replace(/\/+$/, '') + '/discovery/resources'
        try {
          const res = await fetch(url)
          if (!res.ok) return { ...p, status: 'unreachable', error: `HTTP ${res.status}` }
          const data = await res.json() as { items?: unknown[] }
          const items: BazaarItem[] = Array.isArray(data.items)
            ? (data.items as Array<Record<string, unknown>>).map((it) => {
                const metadata = (it.metadata ?? {}) as Record<string, unknown>
                return {
                  resource: String(it.resource ?? ''),
                  type: String(it.type ?? 'http'),
                  description: typeof metadata.description === 'string' ? metadata.description : undefined,
                  accepts: Array.isArray(it.accepts) ? it.accepts as Array<Record<string, unknown>> : [],
                  bazaar: (metadata.bazaar ?? undefined) as BazaarItem['bazaar'],
                }
              })
            : []
          return { ...p, status: 'ok', items }
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err)
          return { ...p, status: 'unreachable', error: msg }
        }
      }))

      if (!cancelled) {
        setProviders(settled)
        setLoading(false)
      }
    }

    if (agents.length === 0) {
      setProviders([])
      setLoading(false)
      return
    }

    run()
    return () => { cancelled = true }
  }, [agents])

  return { providers, loading }
}
