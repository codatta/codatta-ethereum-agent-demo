import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbi, decodeEventLog, decodeAbiParameters, hexToString } from 'viem'
import { addresses, didRegistryAbi, identityRegistryAbi } from '../config/contracts'
import { parseRegistrationFile, type RegistrationFile } from '../lib/parseRegistrationFile'

export interface AgentSummary {
  // null for DID-only providers
  agentId: bigint | null
  owner: string
  // null for ERC-8004-only agents (no DID linked)
  didHex: string | null
  name: string
  description: string
  // ERC-8004 registration file (null for DID-only providers)
  registrationFile: RegistrationFile | null
  // For DID-only providers: derived from DID document CodattaAgent entry
  didMeta: DidAgentMeta | null
}

export interface DidAgentMeta {
  name: string
  description: string
  serviceType: string | null
  active: boolean
  x402Support: boolean
  services: Array<{ name: string; endpoint: string }>
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
        const identAbi = parseAbi(identityRegistryAbi as unknown as string[])
        const didAbi = parseAbi(didRegistryAbi as unknown as string[])

        // ── 1. Query ERC-8004 agents ────────────────────────────────
        const identLogs = await client!.getLogs({
          address: addresses.identityRegistry,
          event: identAbi.find((x) => 'name' in x && x.name === 'Registered')!,
          fromBlock: 0n,
          toBlock: 'latest',
        })

        const results: AgentSummary[] = []
        const linkedDids = new Set<string>()

        for (const log of identLogs) {
          const decoded = decodeEventLog({ abi: identAbi, data: log.data, topics: log.topics })
          const agentId = (decoded.args as any).agentId as bigint
          const owner = (decoded.args as any).owner as string

          let regFile: RegistrationFile | null = null
          try {
            const tokenUri = await client!.readContract({
              address: addresses.identityRegistry, abi: identAbi,
              functionName: 'tokenURI', args: [agentId],
            }) as string
            regFile = parseRegistrationFile(tokenUri)
          } catch {}

          // Find linked DID
          let didHex: string | null = null
          try {
            const didBytes = await client!.readContract({
              address: addresses.identityRegistry, abi: identAbi,
              functionName: 'getMetadata', args: [agentId, 'codatta:did'],
            }) as `0x${string}`
            const [did] = decodeAbiParameters([{ type: 'uint128' }], didBytes)
            didHex = (did as bigint).toString(16)
            linkedDids.add(didHex)
          } catch {}

          results.push({
            agentId, owner, didHex,
            name: regFile?.name || `Agent #${agentId.toString().slice(0, 8)}`,
            description: regFile?.description || '',
            registrationFile: regFile,
            didMeta: null,
          })
        }

        // ── 2. Query DID-only providers ─────────────────────────────
        const didLogs = await client!.getLogs({
          address: addresses.didRegistry,
          event: didAbi.find((x) => 'name' in x && x.name === 'DIDRegistered')!,
          fromBlock: 0n,
          toBlock: 'latest',
        })

        for (const log of didLogs) {
          const decoded = decodeEventLog({ abi: didAbi, data: log.data, topics: log.topics })
          const didId = (decoded.args as any).identifier as bigint
          const didHex = didId.toString(16)
          if (linkedDids.has(didHex)) continue // already counted as ERC-8004 agent

          // Parse DID document for CodattaAgent + service entries
          let meta: DidAgentMeta | null = null
          let currentOwner = ''
          try {
            const doc = await client!.readContract({
              address: addresses.didRegistry, abi: didAbi,
              functionName: 'getDidDocument', args: [didId],
            }) as any
            currentOwner = doc[1] as string
            if (currentOwner === '0x0000000000000000000000000000000000000000') continue

            const arrayAttrs = doc[4] as any[]
            let name = ''
            let description = ''
            let serviceType: string | null = null
            let active = true
            let x402Support = false
            const services: Array<{ name: string; endpoint: string }> = []

            for (const attr of arrayAttrs) {
              const attrName = attr[0] || attr.name
              if (attrName !== 'service') continue
              const values = attr[1] || attr.values || []
              for (const item of values) {
                const val = item[0] || item.value
                const revoked = item[1] || item.revoked || false
                if (revoked) continue
                try {
                  const text = hexToString(val)
                  const parsed = JSON.parse(text)
                  const type = parsed.type || ''
                  if (type === 'CodattaAgent') {
                    name = parsed.name || ''
                    description = parsed.description || ''
                    serviceType = parsed.serviceType || null
                    active = parsed.active !== false
                    x402Support = parsed.x402Support === true
                  } else if (type === 'ERC8004Agent') {
                    continue
                  } else {
                    const label = type === 'MCPServer' ? 'MCP' : type === 'A2AAgent' ? 'A2A' : type
                    services.push({ name: label, endpoint: parsed.serviceEndpoint || '' })
                  }
                } catch {}
              }
            }

            // Must have at least a CodattaAgent entry OR services to be a valid provider
            if (name || services.length > 0) {
              meta = { name, description, serviceType, active, x402Support, services }
            }
          } catch {}

          if (!meta) continue

          results.push({
            agentId: null,
            owner: currentOwner,
            didHex,
            name: meta.name || `DID Agent #${didHex.slice(0, 8)}`,
            description: meta.description,
            registrationFile: null,
            didMeta: meta,
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
