import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'

export type ApiRequest = IncomingMessage & { body?: unknown }
export type ApiResponse = ServerResponse

export function send(res: ApiResponse, status: number, body: unknown) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  res.end(JSON.stringify(body))
}

export async function readJson(req: ApiRequest, limit = 220_000): Promise<unknown> {
  if (req.body !== undefined) return req.body
  let text = ''
  for await (const chunk of req) {
    text += chunk.toString()
    if (text.length > limit) throw new Error('Request is too large.')
  }
  return JSON.parse(text)
}

export async function authenticatedClient(req: ApiRequest) {
  const url = process.env.VITE_SUPABASE_URL
  const key = process.env.VITE_SUPABASE_ANON_KEY
  if (!url || !key) throw new Error('Server authentication is not configured.')
  const token = /^Bearer (.+)$/i.exec(req.headers.authorization ?? '')?.[1]
  if (!token) return null
  const client = createClient(url, key, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })
  const { data, error } = await client.auth.getUser(token)
  if (error || !data.user) return null
  const { data: eligible, error: eligibilityError } = await client.rpc('cali_is_eligible_user')
  if (eligibilityError || !eligible) return null
  const { data: profile, error: profileError } = await client.from('students').select('user_id').eq('user_id', data.user.id).maybeSingle()
  if (profileError || !profile) return null
  return client
}

export function fail(res: ApiResponse, error: unknown) {
  const message = error instanceof Error ? error.message : 'The request could not be completed.'
  const status = message === 'Request is too large.' ? 413 : message === 'Server authentication is not configured.' ? 503 : 400
  send(res, status, { error: message })
}
