import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { parseScheduleText, verifyScheduleUser } from './api/parse-schedule.ts'

export default defineConfig(({ mode }) => ({
  plugins: [react(), tailwindcss(), {
    name: 'local-schedule-api',
    configureServer(server) {
      const env = loadEnv(mode, process.cwd(), '')
      server.middlewares.use('/api/parse-schedule', async (req, res) => {
        res.setHeader('Content-Type', 'application/json')
        if (req.method !== 'POST') {
          res.statusCode = 405
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          const chunks: Buffer[] = []
          for await (const chunk of req) {
            chunks.push(Buffer.from(chunk))
            if (Buffer.concat(chunks).length > 35000) {
              res.statusCode = 413
              res.end(JSON.stringify({ error: 'OCR text is too long.' }))
              return
            }
          }
          const body = JSON.parse(Buffer.concat(chunks).toString()) as { ocrText?: unknown }
          if (typeof body.ocrText !== 'string' || !body.ocrText.trim()) {
            res.statusCode = 400
            res.end(JSON.stringify({ error: 'OCR text is required.' }))
            return
          }
          if (!await verifyScheduleUser(req.headers.authorization, env.VITE_SUPABASE_URL,
            env.VITE_SUPABASE_ANON_KEY)) {
            res.statusCode = 401
            res.end(JSON.stringify({ error: 'Please sign in again to scan your form.' }))
            return
          }
          if (!env.OPENROUTER_SCHEDULE_KEY) {
            res.statusCode = 503
            res.end(JSON.stringify({ error: 'Form scanning is unavailable right now.' }))
            return
          }
          const meetings = await parseScheduleText(body.ocrText, env.OPENROUTER_SCHEDULE_KEY,
            env.OPENROUTER_SCHEDULE_MODEL)
          res.end(JSON.stringify({ meetings }))
        } catch (error) {
          console.error('[local-schedule-api] failed:', error)
          res.statusCode = 502
          res.end(JSON.stringify({ error: 'We could not read the class details. Try a clearer image or add classes manually.' }))
        }
      })
    },
  }],
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    allowedHosts: ['afternoon-shame-petite.ngrok-free.dev'],
  },
}))
