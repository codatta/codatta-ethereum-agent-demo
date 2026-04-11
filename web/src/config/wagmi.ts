import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'
import { ENV } from './env'

export const appChain = defineChain({
  id: ENV.CHAIN_ID,
  name: ENV.CHAIN_NAME,
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: [ENV.RPC_URL] },
  },
})

export const config = createConfig({
  chains: [appChain],
  transports: {
    [appChain.id]: http(),
  },
})
