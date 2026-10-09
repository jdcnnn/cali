import { createClient } from '@supabase/supabase-js'

const redirectQuery = new URLSearchParams(window.location.search)
const redirectHash = new URLSearchParams(window.location.hash.slice(1))
const redirectErrorCode = redirectQuery.get('error') ?? redirectHash.get('error')

export let initialAuthRedirectError = redirectErrorCode ? {
  code: redirectErrorCode,
  description: redirectQuery.get('error_description') ?? redirectHash.get('error_description') ?? '',
} : null

export function clearAuthRedirectError() {
  initialAuthRedirectError = null
  const url = new URL(window.location.href)
  for (const key of ['error', 'error_code', 'error_description']) url.searchParams.delete(key)
  const hash = new URLSearchParams(url.hash.slice(1))
  if (hash.has('error')) {
    for (const key of ['error', 'error_code', 'error_description']) hash.delete(key)
    url.hash = hash.size ? `#${hash.toString()}` : ''
  }
  window.history.replaceState(window.history.state, '', `${url.pathname}${url.search}${url.hash}`)
}

const url = import.meta.env.VITE_SUPABASE_URL
const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY ?? import.meta.env.VITE_SUPABASE_ANON_KEY

export const configurationError =
  !url || !publicKey ? 'Supabase is not configured. Set VITE_SUPABASE_URL and VITE_SUPABASE_PUBLISHABLE_KEY in .env.' : null

export const supabase = configurationError
  ? null
  : createClient(url, publicKey, {
      auth: {
        flowType: 'pkce',
        detectSessionInUrl: true,
        persistSession: true,
        autoRefreshToken: true,
      },
    })

export async function startGoogleSignIn() {
  if (!supabase) throw new Error('Sign-in is unavailable right now. Please try again later.')
  const { error } = await supabase.auth.signInWithOAuth({
    provider: 'google',
    options: {
      redirectTo: window.location.origin,
      queryParams: { prompt: 'select_account' },
    },
  })
  if (error) throw error
}

export type LoginMode = { allowPersonalGoogleLogin: boolean }

export async function getPublicLoginMode(): Promise<LoginMode> {
  if (!supabase) return { allowPersonalGoogleLogin: false }
  const { data, error } = await supabase.rpc('cali_public_login_mode')
  if (error || !data || typeof data !== 'object') return { allowPersonalGoogleLogin: false }
  return { allowPersonalGoogleLogin: (data as { allowPersonalGoogleLogin?: unknown }).allowPersonalGoogleLogin === true }
}
