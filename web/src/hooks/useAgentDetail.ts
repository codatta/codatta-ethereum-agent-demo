import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbi, decodeAbiParameters, decodeEventLog } from 'viem'
import { addresses, identityRegistryAbi, reputationRegistryAbi, validationRegistryAbi } from '../config/contracts'
import { parseRegistrationFile, type RegistrationFile } from '../lib/parseRegistrationFile'

export interface FeedbackRecord {
  clientAddress: string
  score: number
  tag1: string
  tag2: string
}

export interface ValidationRecord {
  requestHash: string
  validatorAddress: string
  requestUri: string
  response?: number
  responseTag?: string
}

export interface AgentDetail {
  agentId: bigint
  owner: string
  registrationFile: RegistrationFile | null
  reputationScore: number
  didIdentifier: bigint | null
  feedbacks: FeedbackRecord[]
  validations: ValidationRecord[]
}

export function useAgentDetail(agentId: string | undefined) {
  const client = usePublicClient()
  const [detail, setDetail] = useState<AgentDetail | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client || !agentId) return
    let cancelled = false

    async function fetch() {
      try {
        setLoading(true)
        const id = BigInt(agentId!)
        const abi = parseAbi(identityRegistryAbi as unknown as string[])

        // Owner + tokenURI
        const owner = await client!.readContract({
          address: addresses.identityRegistry, abi,
          functionName: 'ownerOf', args: [id],
        }) as string

        const tokenUri = await client!.readContract({
          address: addresses.identityRegistry, abi,
          functionName: 'tokenURI', args: [id],
        }) as string

        const regFile = parseRegistrationFile(tokenUri)

        // Reputation
        const repAbi = parseAbi(reputationRegistryAbi as unknown as string[])
        let reputationScore = 0
        try {
          const score = await client!.readContract({
            address: addresses.reputationRegistry, abi: repAbi,
            functionName: 'getScore', args: [id],
          }) as bigint
          reputationScore = Number(score)
        } catch {}

        // DID from metadata
        let didIdentifier: bigint | null = null
        try {
          const didBytes = await client!.readContract({
            address: addresses.identityRegistry, abi,
            functionName: 'getMetadata', args: [id, 'codatta:did'],
          }) as `0x${string}`
          const [decoded] = decodeAbiParameters([{ type: 'uint128' }], didBytes)
          didIdentifier = decoded as bigint
        } catch {}

        // Feedback events
        const feedbacks: FeedbackRecord[] = []
        try {
          const feedbackEvent = repAbi.find((x) => 'name' in x && x.name === 'NewFeedback')!
          const logs = await client!.getLogs({
            address: addresses.reputationRegistry,
            event: feedbackEvent,
            args: { agentId: id },
            fromBlock: 0n, toBlock: 'latest',
          })
          for (const log of logs) {
            const decoded = decodeEventLog({ abi: repAbi, data: log.data, topics: log.topics })
            const args = decoded.args as any
            feedbacks.push({
              clientAddress: args.clientAddress,
              score: Number(args.score),
              tag1: args.tag1, tag2: args.tag2,
            })
          }
        } catch {}

        // Validation events
        const validations: ValidationRecord[] = []
        try {
          const valAbi = parseAbi(validationRegistryAbi as unknown as string[])
          const reqEvent = valAbi.find((x) => 'name' in x && x.name === 'ValidationRequest')!
          const reqLogs = await client!.getLogs({
            address: addresses.validationRegistry,
            event: reqEvent,
            args: { agentId: id },
            fromBlock: 0n, toBlock: 'latest',
          })
          for (const log of reqLogs) {
            const decoded = decodeEventLog({ abi: valAbi, data: log.data, topics: log.topics })
            const args = decoded.args as any
            const rec: ValidationRecord = {
              requestHash: args.requestHash,
              validatorAddress: args.validatorAddress,
              requestUri: args.requestUri,
            }
            // Get response
            try {
              const status = await client!.readContract({
                address: addresses.validationRegistry, abi: valAbi,
                functionName: 'getValidationStatus', args: [args.requestHash],
              }) as any[]
              if (Number(status[2]) > 0) {
                rec.response = Number(status[2])
                rec.responseTag = status[4]
              }
            } catch {}
            validations.push(rec)
          }
        } catch {}

        if (!cancelled) {
          setDetail({ agentId: id, owner, registrationFile: regFile, reputationScore, didIdentifier, feedbacks, validations })
        }
      } catch {
        if (!cancelled) setDetail(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    return () => { cancelled = true }
  }, [client, agentId])

  return { detail, loading }
}
