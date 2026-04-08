export interface RegistrationFile {
  type?: string
  name?: string
  description?: string
  image?: string
  services?: Array<{ name: string; endpoint: string; version?: string }>
  active?: boolean
  registrations?: Array<{ agentId: string; agentRegistry: string }>
  supportedTrust?: string[]
  x402Support?: boolean
}

export function parseRegistrationFile(tokenUri: string): RegistrationFile | null {
  try {
    if (tokenUri.startsWith('data:application/json;base64,')) {
      const base64 = tokenUri.replace('data:application/json;base64,', '')
      return JSON.parse(atob(base64))
    }
    return null
  } catch {
    return null
  }
}
