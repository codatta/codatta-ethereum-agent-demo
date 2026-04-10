import { http, createConfig } from 'wagmi'
import { defineChain } from 'viem'

export const anvilLocal = defineChain({
  id: 31337,
  name: 'Anvil Local',
  nativeCurrency: { name: 'Ether', symbol: 'ETH', decimals: 18 },
  rpcUrls: {
    default: { http: ['http://127.0.0.1:8086'] },
  },
})

export const config = createConfig({
  chains: [anvilLocal],
  transports: {
    [anvilLocal.id]: http(),
  },
})
