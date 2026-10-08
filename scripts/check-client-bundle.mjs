import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'

const secrets = ['SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY', 'SUPABASE_DB_PASSWORD']
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

inspect('dist')
if (leaks.length) throw new Error(`Server secret found in client bundle: ${leaks.join(', ')}`)
console.log('Client bundle check passed. No server secrets were included.')
