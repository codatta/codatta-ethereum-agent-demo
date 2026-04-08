import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbi, decodeEventLog } from 'viem'
import { addresses, identityRegistryAbi } from '../config/contracts'
import { parseRegistrationFile, type RegistrationFile } from '../lib/parseRegistrationFile'

export interface AgentSummary {
  agentId: bigint
  owner: string
  name: string
  description: string
  registrationFile: RegistrationFile | null
}

export function useAgentList() {
  const client = usePublicClient()
  const [agents, setAgents] = useState<AgentSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!client) return
    let cancelled = false

    async function fetchAgents() {
      try {
        setLoading(true)
        const logs = await client!.getLogs({
          address: addresses.identityRegistry,
          event: parseAbi(identityRegistryAbi as unknown as string[]).find(
            (x) => 'name' in x && x.name === 'Registered'
          )!,
          fromBlock: 0n,
          toBlock: 'latest',
        })

        const results: AgentSummary[] = []

        for (const log of logs) {
          const decoded = decodeEventLog({
            abi: parseAbi(identityRegistryAbi as unknown as string[]),
            data: log.data,
            topics: log.topics,
          })
          const agentId = (decoded.args as any).agentId as bigint
          const owner = (decoded.args as any).owner as string
          const tokenUri = (decoded.args as any).tokenURI as string

          const regFile = parseRegistrationFile(tokenUri)
          results.push({
            agentId,
            owner,
            name: regFile?.name || `Agent #${agentId.toString().slice(0, 8)}`,
            description: regFile?.description || '',
            registrationFile: regFile,
          })
        }

        if (!cancelled) {
          setAgents(results)
          setError(null)
        }
      } catch (err: any) {
        if (!cancelled) setError(err.message)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetchAgents()
    return () => { cancelled = true }
  }, [client])

  return { agents, loading, error }
}
