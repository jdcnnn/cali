import { defineConfig, loadEnv } from 'vite'
import type { Plugin } from 'vite'
import type { IncomingMessage, ServerResponse } from 'node:http'
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

function reviewerGenerationApi(): Plugin {
  return {
    name: 'reviewer-generation-api',
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = new URL(request.url ?? '/', 'http://localhost').pathname
        if (pathname !== '/api/study/reviewer-generation') { next(); return }
        try {
          const module = await server.ssrLoadModule('/api/study/reviewer-generation.ts') as { default: (request: IncomingMessage, response: ServerResponse) => Promise<void> }
          await module.default(request, response)
        } catch (error) {
          server.config.logger.error(error instanceof Error ? error.stack ?? error.message : String(error))
          if (!response.headersSent) {
            response.statusCode = 500
            response.setHeader('Content-Type', 'application/json; charset=utf-8')
          }
          if (!response.writableEnded) response.end(JSON.stringify({ error: 'Reviewer generation could not start. Please try again.' }))
        }
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY']) {
    if (!process.env[name] && env[name]) process.env[name] = env[name]
  }
  return {
    resolve: {
      alias: [{ find: /^onnxruntime-web$/, replacement: 'onnxruntime-web/wasm' }],
      conditions: ['onnxruntime-web-use-extern-wasm'],
    },
    worker: {
      plugins: () => [disablePaddleNestedWorker()],
    },
    plugins: [disablePaddleNestedWorker(), react(), tailwindcss(), reviewerGenerationApi(), {
      name: 'local-ocr-runtime-assets',
      enforce: 'pre',
      configureServer(server) {
        server.middlewares.use((request, _response, next) => {
          if (/^\/ocr\/(?:v1\/)?runtime\//.test(request.url ?? '') && request.url?.includes('?import')) {
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
  }
})
