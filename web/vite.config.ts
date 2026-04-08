import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    fs: {
      // Allow importing deployment.json from parent directory
      allow: ['..'],
    },
  },
})
