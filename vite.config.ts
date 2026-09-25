import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss(), {
    name: 'local-ocr-runtime-assets',
    enforce: 'pre',
    configureServer(server) {
      server.middlewares.use((request, _response, next) => {
        if (request.url?.startsWith('/ocr/runtime/') && request.url.includes('?import')) {
          request.url = request.url.replace(/\?import(?:&.*)?$/, '')
        }
        next()
      })
    },
  }],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['afternoon-shame-petite.ngrok-free.dev'],
  },
})
