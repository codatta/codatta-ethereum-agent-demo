import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow importing deployment.json from parent directory
      allow: ['..'],
    },
    proxy: {
      // Coinbase CDP's public x402 Bazaar doesn't send CORS headers, so the
      // browser refuses cross-origin fetch. Route the request through vite
      // (server-side) to bypass CORS in dev. For prod, a real backend proxy
      // (or invite-service /bazaar route) would do the same.
      '/bazaar-api': {
        target: 'https://api.cdp.coinbase.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/bazaar-api/, '/platform/v2/x402'),
      },
    },
  },
})
