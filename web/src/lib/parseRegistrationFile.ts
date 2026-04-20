export interface RegistrationFile {
  type?: string
  name?: string
  description?: string
  serviceType?: string
  image?: string
  services?: Array<{ name: string; endpoint: string; version?: string }>
  active?: boolean
  registrations?: Array<{ agentId: string; agentRegistry: string }>
  supportedTrust?: string[]
  x402Support?: boolean
}

/**
 * Parse an ERC-8004 tokenURI into a RegistrationFile.
 *
 * Supports:
 *   - data:application/json;base64,... (legacy inline)
 *   - http(s):// URLs (fetched — preferred, single source of truth with profile service)
 *   - ipfs:// URLs (via public gateway)
 */
export async function parseRegistrationFile(tokenUri: string): Promise<RegistrationFile | null> {
  try {
    if (tokenUri.startsWith('data:application/json;base64,')) {
      const base64 = tokenUri.replace('data:application/json;base64,', '')
      return JSON.parse(atob(base64))
    }
    if (tokenUri.startsWith('http://') || tokenUri.startsWith('https://')) {
      const res = await fetch(tokenUri)
      if (!res.ok) return null
      return await res.json() as RegistrationFile
    }
    if (tokenUri.startsWith('ipfs://')) {
      const cid = tokenUri.replace('ipfs://', '')
      const res = await fetch(`https://ipfs.io/ipfs/${cid}`)
      if (!res.ok) return null
      return await res.json() as RegistrationFile
    }
    return null
  } catch {
    return null
  }
}
