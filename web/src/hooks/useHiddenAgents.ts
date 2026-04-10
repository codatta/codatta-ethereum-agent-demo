import { useEffect, useState, useCallback } from 'react'

const INVITE_SERVICE_URL = 'http://127.0.0.1:4060'

export function useHiddenAgents() {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const refresh = useCallback(async () => {
    try {
      const res = await fetch(`${INVITE_SERVICE_URL}/agents/hidden`)
      if (res.ok) {
        const data = await res.json() as { hidden: string[] }
        setHidden(new Set(data.hidden))
      }
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { refresh() }, [refresh])

  const hideAgent = useCallback(async (agentId: string) => {
    try {
      await fetch(`${INVITE_SERVICE_URL}/agents/${agentId}/hide`, { method: 'POST' })
      setHidden(prev => new Set([...prev, agentId]))
    } catch {}
  }, [])

  const showAgent = useCallback(async (agentId: string) => {
    try {
      await fetch(`${INVITE_SERVICE_URL}/agents/${agentId}/show`, { method: 'POST' })
      setHidden(prev => { const next = new Set(prev); next.delete(agentId); return next })
    } catch {}
  }, [])

  return { hidden, loading, hideAgent, showAgent, refresh }
}
