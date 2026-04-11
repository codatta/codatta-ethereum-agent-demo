import { useEffect, useState, useCallback } from 'react'

import { ENV } from '../config/env'
const INVITE_SERVICE_URL = ENV.INVITE_SERVICE_URL

export function useHiddenAgents() {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [loading, setLoading] = useState(true)

  const fetchHidden = useCallback(async () => {
    try {
      const res = await fetch(`${INVITE_SERVICE_URL}/agents/hidden`)
      if (res.ok) {
        const data = await res.json() as { hidden: string[] }
        setHidden(new Set(data.hidden))
      } else {
        console.warn('[useHiddenAgents] fetch failed:', res.status)
      }
    } catch (err) {
      console.warn('[useHiddenAgents] fetch error:', err)
    }
    setLoading(false)
  }, [])

  useEffect(() => { fetchHidden() }, [fetchHidden])

  const hideAgent = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`${INVITE_SERVICE_URL}/agents/${agentId}/hide`, { method: 'POST' })
      if (!res.ok) {
        console.error('[useHiddenAgents] hide failed:', res.status, await res.text())
        return
      }
      // Update local state immediately
      setHidden(prev => new Set([...prev, agentId]))
      console.log('[useHiddenAgents] hidden:', agentId)
    } catch (err) {
      console.error('[useHiddenAgents] hide error:', err)
    }
  }, [])

  const showAgent = useCallback(async (agentId: string) => {
    try {
      const res = await fetch(`${INVITE_SERVICE_URL}/agents/${agentId}/show`, { method: 'POST' })
      if (!res.ok) {
        console.error('[useHiddenAgents] show failed:', res.status, await res.text())
        return
      }
      setHidden(prev => { const next = new Set(prev); next.delete(agentId); return next })
      console.log('[useHiddenAgents] shown:', agentId)
    } catch (err) {
      console.error('[useHiddenAgents] show error:', err)
    }
  }, [])

  return { hidden, loading, hideAgent, showAgent, refresh: fetchHidden }
}
