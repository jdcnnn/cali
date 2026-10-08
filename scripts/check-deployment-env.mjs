const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_PUBLISHABLE_KEY',
  'VITE_VAPID_PUBLIC_KEY',
  'SUPABASE_URL',
  'SUPABASE_ANON_KEY',
  'SUPABASE_SERVICE_ROLE_KEY',
  'OPENROUTER_API_KEY',
]

const placeholder = /^(?:your_|replace|change-?me|placeholder|todo)/i
const missing = required.filter(name => {
  const value = process.env[name]?.trim()
  return !value || placeholder.test(value)
})

if (missing.length) {
  throw new Error(`Missing deployment environment variables: ${missing.join(', ')}`)
}

for (const name of ['VITE_SUPABASE_URL', 'SUPABASE_URL']) {
  try {
    const url = new URL(process.env[name])
    if (url.protocol !== 'https:') throw new Error('must use HTTPS')
  } catch {
    throw new Error(`${name} must be a valid HTTPS URL`)
  }
}

if (process.env.VITE_SUPABASE_URL !== process.env.SUPABASE_URL) {
  throw new Error('VITE_SUPABASE_URL and SUPABASE_URL must point to the same project')
}

if (!process.env.OPENROUTER_API_KEY.startsWith('sk-or-')) {
  throw new Error('OPENROUTER_API_KEY does not look like an OpenRouter API key')
}

console.log('Deployment environment check passed. All required client and server variables are configured.')
