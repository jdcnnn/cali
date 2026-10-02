import { defineConfig } from 'vite'
import type { Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

function disablePaddleNestedWorker(): Plugin {
  return {
    name: 'disable-paddle-nested-worker',
    enforce: 'pre',
    transform(code, id) {
      if (!id.replaceAll('\\', '/').includes('/@paddleocr/paddleocr-js/dist/index.mjs')) return
      return code.replace(
        /new URL\("\.\/assets\/worker-entry-[^"]+\.js", import\.meta\.url\)/g,
        'new URL("data:application/javascript,", import.meta.url)',
      )
    },
    renderChunk(code) {
      return code.replace(/([`"'])\/assets\/worker-entry-[^`"']+\.js\1/g, '"data:application/javascript,"')
    },
    generateBundle(_options, bundle) {
      for (const fileName of Object.keys(bundle)) {
        if (/^assets\/worker-entry-[^/]+\.js$/.test(fileName)) delete bundle[fileName]
      }
    },
  }
}

export default defineConfig({
  resolve: {
    alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }],
    conditions: ['onnxruntime-web-use-extern-wasm'],
  },
  worker: {
    plugins: () => [disablePaddleNestedWorker()],
  },
  plugins: [disablePaddleNestedWorker(), react(), tailwindcss(), {
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
