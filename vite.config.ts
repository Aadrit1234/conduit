import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// Where the Conduit backend lives during development (see server/.env.example).
// Override with CONDUIT_SERVER=http://host:port.
const serverTarget = process.env.CONDUIT_SERVER ?? 'http://localhost:8787'
const wsTarget = serverTarget.replace(/^http/, 'ws')

// https://vite.dev/config/
export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/rooms': { target: serverTarget, changeOrigin: true },
      '/health': { target: serverTarget, changeOrigin: true },
      '/ws': { target: wsTarget, ws: true },
    },
  },
})
