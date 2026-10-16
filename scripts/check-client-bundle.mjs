import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { gzipSync } from 'node:zlib'

const outputDirectory = 'dist'

const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'SUPABASE_DB_PASSWORD', 'VAPID_PRIVATE_KEY', 'CALI_CRON_SECRET']
  .map(name => [name, process.env[name]?.trim()])
  .filter((entry) => entry[1])

const leaks = []
function inspect(directory) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) inspect(path)
    else {
      const contents = readFileSync(path)
      for (const [name, value] of secrets) {
        if (contents.includes(Buffer.from(value))) leaks.push(`${name} in ${path}`)
      }
    }
  }
}

inspect(outputDirectory)
if (leaks.length) throw new Error(`Server secret found in client bundle: ${leaks.join(', ')}`)
console.log('Client bundle check passed. No server secrets were included.')

function outputPath(url) {
  return join(outputDirectory, url.replace(/^\//, '').split(/[?#]/, 1)[0])
}

function gzipSize(path) {
  return gzipSync(readFileSync(path), { level: 9 }).byteLength
}

function formatSize(bytes) {
  return `${(bytes / 1024).toFixed(1)} KiB`
}

function checkBudget(label, bytes, limit) {
  if (bytes > limit) throw new Error(`${label} is ${formatSize(bytes)}; budget is ${formatSize(limit)}.`)
}

const indexHtml = readFileSync(join(outputDirectory, 'index.html'), 'utf8')
const initialUrls = [...indexHtml.matchAll(/<(?:script|link)\b[^>]*(?:src|href)="([^"]+)"/g)]
  .map(match => match[1])
  .filter(url => url.startsWith('/assets/'))
const uniqueInitialUrls = [...new Set(initialUrls)]
const initialJs = uniqueInitialUrls.filter(url => url.endsWith('.js')).reduce((total, url) => total + gzipSize(outputPath(url)), 0)
const initialCss = uniqueInitialUrls.filter(url => url.endsWith('.css')).reduce((total, url) => total + gzipSize(outputPath(url)), 0)

checkBudget('Initial JavaScript (gzip)', initialJs, 230 * 1024)
checkBudget('Initial CSS (gzip)', initialCss, 70 * 1024)

const emittedAssets = readdirSync(join(outputDirectory, 'assets')).map(name => join(outputDirectory, 'assets', name))
for (const path of emittedAssets) {
  const name = path.replaceAll('\\', '/').split('/').at(-1) ?? path
  if (name.endsWith('.js') && !name.includes('.worker-') && !name.startsWith('pdf.worker.')) {
    checkBudget(`JavaScript chunk ${name} (gzip)`, gzipSize(path), 210 * 1024)
  }
  if (/\.(?:png|jpe?g|webp|avif)$/i.test(name)) {
    checkBudget(`Raster image ${name}`, statSync(path).size, 600 * 1024)
  }
}

console.log(`Performance budgets passed. Initial JavaScript: ${formatSize(initialJs)} gzip; initial CSS: ${formatSize(initialCss)} gzip.`)
