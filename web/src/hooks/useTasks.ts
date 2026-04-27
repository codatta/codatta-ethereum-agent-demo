import { useCallback, useEffect, useState } from 'react'
import { ENV } from '../config/env'

export type TaskStatus = 'pending' | 'accepted' | 'working' | 'completed' | 'failed' | 'cancelled'

export interface AsyncTask {
  id: string
  agentId: string
  providerAddress: string
  providerDid: string | null
  serviceName: string
  clientAddress: string
  clientDid: string | null
  payload: unknown
  status: TaskStatus
  result: unknown | null
  error: string | null
  note: string | null
  createdAt: string
  acceptedAt: string | null
  startedAt: string | null
  completedAt: string | null
}

export interface TaskListResponse {
  total: number
  counts: Record<TaskStatus, number>
  tasks: AsyncTask[]
}

export function useTasks(providerAddress: string | undefined, filters: { status?: string; serviceName?: string } = {}, pollMs = 4000) {
  const [data, setData] = useState<TaskListResponse | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async () => {
    if (!providerAddress) { setData(null); return }
    setLoading(true)
    try {
      const params = new URLSearchParams({ providerAddress })
      if (filters.status) params.set('status', filters.status)
      if (filters.serviceName) params.set('serviceName', filters.serviceName)
      const res = await fetch(`${ENV.INVITE_SERVICE_URL}/tasks?${params.toString()}`)
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const json = await res.json() as TaskListResponse
      setData(json)
      setError(null)
    } catch (err: any) {
      setError(err.message || String(err))
    } finally {
      setLoading(false)
    }
  }, [providerAddress, filters.status, filters.serviceName])

  useEffect(() => {
    load()
    if (!providerAddress) return
    const handle = setInterval(load, pollMs)
    return () => clearInterval(handle)
  }, [load, providerAddress, pollMs])

  return { data, error, loading, reload: load }
}

export async function transitionTask(taskId: string, action: 'accept' | 'work' | 'complete' | 'fail' | 'cancel', body: Record<string, unknown> = {}): Promise<AsyncTask> {
  const res = await fetch(`${ENV.INVITE_SERVICE_URL}/tasks/${encodeURIComponent(taskId)}/${action}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) throw new Error(`${action} failed: HTTP ${res.status} — ${await res.text()}`)
  return await res.json() as AsyncTask
}
