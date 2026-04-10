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
        const abi = parseAbi(identityRegistryAbi as unknown as string[])

        // Get all registered agent IDs from events
        const logs = await client!.getLogs({
          address: addresses.identityRegistry,
          event: abi.find((x) => 'name' in x && x.name === 'Registered')!,
          fromBlock: 0n,
          toBlock: 'latest',
        })

        const results: AgentSummary[] = []

        for (const log of logs) {
          const decoded = decodeEventLog({ abi, data: log.data, topics: log.topics })
          const agentId = (decoded.args as any).agentId as bigint
          const owner = (decoded.args as any).owner as string

          // Read CURRENT tokenURI from chain (not event snapshot)
          let regFile: RegistrationFile | null = null
          try {
            const tokenUri = await client!.readContract({
              address: addresses.identityRegistry,
              abi,
              functionName: 'tokenURI',
              args: [agentId],
            }) as string
            regFile = parseRegistrationFile(tokenUri)
          } catch {}

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
