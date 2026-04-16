/**
 * Environment configuration for Web Dashboard.
 * Change these values for different deployment environments.
 */
export const ENV = {
  // Invite Service URL (backend for invites, verification, try-it proxy, agent management)
  INVITE_SERVICE_URL: import.meta.env.VITE_INVITE_SERVICE_URL || 'http://127.0.0.1:4060',

  // RPC URL for blockchain connection
  RPC_URL: import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8545',

  // Chain ID
  CHAIN_ID: parseInt(import.meta.env.VITE_CHAIN_ID || '31337'),

  // Chain name
  CHAIN_NAME: import.meta.env.VITE_CHAIN_NAME || 'Anvil Local',

  // Default provider ports (for deriving endpoints from base URL)
  DEFAULT_PORTS: {
    web: parseInt(import.meta.env.VITE_DEFAULT_PORT_WEB || '4021'),
    mcp: parseInt(import.meta.env.VITE_DEFAULT_PORT_MCP || '4022'),
    a2a: parseInt(import.meta.env.VITE_DEFAULT_PORT_A2A || '4023'),
  },
} as const

/** Convert uint128 hex to did:codatta:<uuid> format */
export function hexToDidUri(hex: string): string {
  const h = hex.replace(/^0x/, '').padStart(32, '0')
  const uuid = `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20, 32)}`
  return `did:codatta:${uuid}`
}

/** Parse did:codatta:<uuid> (or <hex>) to raw hex string */
export function didUriToHex(did: string): string {
  const body = did.replace(/^did:codatta:/, '').replace(/-/g, '').toLowerCase()
  return body
}

/** Normalize an endpoint string — if it's a did:codatta: URI in hex form,
 *  convert to UUID format. Otherwise return unchanged. */
export function normalizeEndpoint(endpoint: string): string {
  if (!endpoint.startsWith('did:codatta:')) return endpoint
  const body = endpoint.replace(/^did:codatta:/, '')
  if (body.includes('-')) return endpoint // already UUID format
  if (!/^[0-9a-fA-F]+$/.test(body)) return endpoint // not plain hex
  return hexToDidUri(body)
}
