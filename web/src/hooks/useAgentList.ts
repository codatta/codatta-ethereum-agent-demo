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
            regFile = await parseRegistrationFile(tokenUri)
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

          // DID document holds only identity + pointers. Profile data (name/desc/services)
          // lives in the #profile service entry's URL, fetched as ERC-8004 registrationFile.
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
            let profileUrl: string | null = null

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
                  if (parsed.type === 'AgentProfile' && parsed.serviceEndpoint) {
                    profileUrl = parsed.serviceEndpoint
                  }
                } catch {}
              }
            }

            if (profileUrl) {
              const profile = await parseRegistrationFile(profileUrl)
              if (profile) {
                const services = (profile.services || [])
                  .filter(s => s.name !== 'DID' && s.name !== 'web')
                  .map(s => ({ name: s.name, endpoint: s.endpoint }))
                meta = {
                  name: profile.name || '',
                  description: profile.description || '',
                  serviceType: profile.serviceType || null,
                  active: profile.active !== false,
                  x402Support: profile.x402Support === true,
                  services,
                }
              }
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
