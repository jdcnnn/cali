import { createServer } from 'node:http'
import parse from '../api/schedule/parse.ts'
import replace from '../api/schedule/replace.ts'

createServer((req, res) => {
  const route = new URL(req.url ?? '/', 'http://localhost').pathname
  if (route === '/api/schedule/parse') { void parse(req, res); return }
  if (route === '/api/schedule/replace') { void replace(req, res); return }
  res.statusCode = 404
  res.end('Not found')
}).listen(8787, '127.0.0.1', () => { process.stdout.write('Schedule API ready on http://127.0.0.1:8787\n') })
