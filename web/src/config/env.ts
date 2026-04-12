/**
 * Environment configuration for Web Dashboard.
 * Change these values for different deployment environments.
 */
export const ENV = {
  // Invite Service URL (backend for invites, verification, try-it proxy, agent management)
  INVITE_SERVICE_URL: import.meta.env.VITE_INVITE_SERVICE_URL || 'http://127.0.0.1:4160',

  // RPC URL for blockchain connection
  RPC_URL: import.meta.env.VITE_RPC_URL || 'http://127.0.0.1:8086',

  // Chain ID
  CHAIN_ID: parseInt(import.meta.env.VITE_CHAIN_ID || '31337'),

  // Chain name
  CHAIN_NAME: import.meta.env.VITE_CHAIN_NAME || 'Anvil Local',

  // Default provider ports (for deriving endpoints from base URL)
  DEFAULT_PORTS: {
    web: parseInt(import.meta.env.VITE_DEFAULT_PORT_WEB || '4121'),
    mcp: parseInt(import.meta.env.VITE_DEFAULT_PORT_MCP || '4122'),
    a2a: parseInt(import.meta.env.VITE_DEFAULT_PORT_A2A || '4123'),
  },
} as const
