import { useEffect, useState } from 'react'
import { usePublicClient } from 'wagmi'
import { parseAbi, hexToString } from 'viem'
import { addresses, didRegistryAbi } from '../config/contracts'

export interface DIDArrayItem {
  value: string
  revoked: boolean
  isJson: boolean
  parsed?: any
}

export interface DIDArrayAttribute {
  name: string
  items: DIDArrayItem[]
}

export interface DIDDocument {
  id: bigint
  idHex: string
  owner: string
  controllers: bigint[]
  kvAttributes: Array<{ name: string; value: string }>
  arrayAttributes: DIDArrayAttribute[]
}

export function useDIDDocument(identifierHex: string | undefined) {
  const client = usePublicClient()
  const [doc, setDoc] = useState<DIDDocument | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!client || !identifierHex) return
    let cancelled = false

    async function fetch() {
      try {
        setLoading(true)
        const identifier = BigInt(`0x${identifierHex}`)
        const abi = parseAbi(didRegistryAbi as unknown as string[])

        const result = await client!.readContract({
          address: addresses.didRegistry, abi,
          functionName: 'getDidDocument', args: [identifier],
        }) as any

        const id = result[0] as bigint
        const owner = result[1] as string
        const controllers = Array.from(result[2] as bigint[])
        const kvAttrs = Array.from(result[3] as any[]).map((attr: any) => ({
          name: attr[0] || attr.name,
          value: attr[1] || attr.value,
        }))

        const arrayAttrs: DIDArrayAttribute[] = []
        for (const attr of Array.from(result[4] as any[])) {
          const name = attr[0] || attr.name
          const items: DIDArrayItem[] = []
          const values = attr[1] || attr.values || []
          for (const item of Array.from(values)) {
            const val = (item as any)[0] || (item as any).value
            const revoked = (item as any)[1] || (item as any).revoked || false
            let text = ''
            let isJson = false
            let parsed: any = undefined
            try {
              text = hexToString(val)
              try { parsed = JSON.parse(text); isJson = true } catch {}
            } catch {
              text = val
            }
            items.push({ value: text, revoked, isJson, parsed })
          }
          arrayAttrs.push({ name, items })
        }

        if (!cancelled) {
          setDoc({
            id, idHex: id.toString(16), owner, controllers,
            kvAttributes: kvAttrs, arrayAttributes: arrayAttrs,
          })
        }
      } catch {
        if (!cancelled) setDoc(null)
      } finally {
        if (!cancelled) setLoading(false)
      }
    }

    fetch()
    return () => { cancelled = true }
  }, [client, identifierHex])

  return { doc, loading }
}
