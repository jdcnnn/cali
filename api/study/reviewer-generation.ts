import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import {
  buildOpenRouterReviewerBody,
  parseGeneratedReviewerResponse,
  parseReviewerGenerationInput,
  REVIEWER_PROMPT_VERSION,
  reviewerToTiptap,
} from '../../server/reviewerGeneration.js'

export const maxDuration = 120

function send(response: ServerResponse, status: number, body: unknown) {
  response.statusCode = status
  response.setHeader('Content-Type', 'application/json; charset=utf-8')
  response.setHeader('Cache-Control', 'no-store')
  response.end(JSON.stringify(body))
}

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
    size += buffer.length
    if (size > 500_000) throw new Error('BODY_TOO_LARGE')
    chunks.push(buffer)
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'))
}

function publicError(category: string) {
  if (category === 'quota') return { status: 429, message: 'You have used all 10 reviewer generations for this month. Your limit resets next month.' }
  if (category === 'active') return { status: 409, message: 'Another reviewer is being generated. Wait for it to finish, then retry.' }
  if (category === 'provider_capacity') return { status: 503, message: 'Reviewer generation is busy right now. Your source is still here—please try again shortly.' }
  if (category === 'provider_timeout') return { status: 504, message: 'Reviewer generation took too long. Your source is still here—please try again.' }
  if (category === 'output_limit') return { status: 502, message: 'The reviewer was too long to finish. Choose Quick or shorten the extracted text, then try again.' }
  if (category === 'invalid_output') return { status: 502, message: 'Cali could not organize this source into a reviewer. Check the extracted text, then try again.' }
  return { status: 502, message: 'The generated reviewer could not be prepared. Your source is still here—please try again.' }
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); send(response, 405, { error: 'Method not allowed.' }); return }
  const supabaseUrl = process.env.SUPABASE_URL
  const anonKey = process.env.SUPABASE_ANON_KEY
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const openRouterKey = process.env.OPENROUTER_API_KEY
  if (!supabaseUrl || !anonKey || !serviceKey || !openRouterKey) { send(response, 503, { error: 'Reviewer generation is not configured.' }); return }
  const authorization = request.headers.authorization
  if (!authorization?.startsWith('Bearer ')) { send(response, 401, { error: 'Sign in to generate a reviewer.' }); return }

  let input
  try { input = parseReviewerGenerationInput(await readJson(request)) } catch { input = null }
  if (!input) { send(response, 400, { error: 'Check the source text, detail level, and request ID.' }); return }

  const authClient = createClient(supabaseUrl, anonKey, { global: { headers: { Authorization: authorization } }, auth: { persistSession: false } })
  const { data: authData, error: authError } = await authClient.auth.getUser(authorization.slice(7))
  const user = authData.user
  if (authError || !user) { send(response, 401, { error: 'Your session has expired. Sign in and try again.' }); return }
  const hasGoogleIdentity = user.identities?.some(identity => identity.provider === 'google') === true
  if (!user.email_confirmed_at || !hasGoogleIdentity || !user.email?.toLowerCase().endsWith('@rtu.edu.ph')) { send(response, 403, { error: 'A verified RTU Google account is required.' }); return }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: student } = await admin.from('students').select('user_id').eq('user_id', user.id).maybeSingle()
  if (!student) { send(response, 403, { error: 'Complete your RTU student profile before using AI generation.' }); return }

  const { data: reservation, error: reservationError } = await admin.rpc('cali_reserve_reviewer_generation', {
    p_request_id: input.requestId, p_user_id: user.id, p_source_type: input.sourceType, p_detail: input.detail, p_prompt_version: REVIEWER_PROMPT_VERSION,
  })
  if (reservationError) {
    const category = reservationError.message.includes('PERSONAL_LIMIT') ? 'quota' : reservationError.message.includes('ALREADY_PROCESSING') ? 'active' : 'database'
    const shown = publicError(category); send(response, shown.status, { error: shown.message, category }); return
  }
  const reserved = reservation as { action?: string; status?: string; draft?: unknown }
  if (reserved?.action === 'existing' && reserved.draft) { send(response, 200, reserved.draft); return }
  if (reserved?.action === 'existing' && reserved.status === 'processing') { send(response, 409, { error: 'This reviewer is still being generated. Wait a moment, then retry.', category: 'active' }); return }
  if (reserved?.action === 'existing') { send(response, 409, { error: 'This generation request was already submitted. Start a new request to retry.', category: 'idempotent_replay' }); return }

  let failureCategory = 'provider_error'
  try {
    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 110_000)
    type ProviderResult = { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { finish_reason?: string; message?: { content?: unknown; parsed?: unknown } }[] }
    let successfulProvider: ProviderResult | null = null
    let generated: ReturnType<typeof parseGeneratedReviewerResponse> = null
    let promptTokens = 0
    let outputTokens = 0
    try {
      for (const retry of [false, true]) {
        const providerResponse = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST', signal: controller.signal,
          headers: { Authorization: `Bearer ${openRouterKey}`, 'Content-Type': 'application/json', 'HTTP-Referer': request.headers.origin ?? 'https://cali.app', 'X-Title': 'Cali Study Reviewer' },
          body: JSON.stringify(buildOpenRouterReviewerBody(input.sourceText, input.detail, retry)),
        })
        if (!providerResponse.ok) {
          failureCategory = providerResponse.status === 408 || providerResponse.status === 429 || providerResponse.status >= 500 ? 'provider_capacity' : 'provider_error'
          throw new Error(`OpenRouter ${providerResponse.status}`)
        }
        const provider = await providerResponse.json() as ProviderResult
        promptTokens += provider.usage?.prompt_tokens ?? 0
        outputTokens += provider.usage?.completion_tokens ?? 0
        const choice = provider.choices?.[0]
        generated = parseGeneratedReviewerResponse(choice?.message?.parsed ?? choice?.message?.content)
        if (generated) { successfulProvider = provider; break }

        failureCategory = choice?.finish_reason === 'length' ? 'output_limit' : 'invalid_output'
        const content = choice?.message?.content
        const contentLength = typeof content === 'string' ? content.length : Array.isArray(content) ? content.length : 0
        console.warn('Reviewer generation returned invalid structured output.', { attempt: retry ? 'fallback' : 'primary', model: provider.model ?? 'unknown', finishReason: choice?.finish_reason ?? 'unknown', contentLength })
      }
    } finally { clearTimeout(timeout) }
    if (!generated || !successfulProvider) throw new Error('Invalid structured output')
    const converted = reviewerToTiptap(generated)
    const model = successfulProvider.model ?? 'unknown'
    const { error: completionError } = await admin.rpc('cali_complete_reviewer_generation', {
      p_request_id: input.requestId, p_user_id: user.id, p_model: model,
      p_prompt_tokens: promptTokens || null, p_output_tokens: outputTokens || null,
      p_title: generated.title, p_content: converted.content, p_plain_text: converted.plainText,
    })
    if (completionError) { failureCategory = 'database'; throw completionError }
    send(response, 200, { requestId: input.requestId, title: generated.title, content: converted.content, plainText: converted.plainText, revision: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') failureCategory = 'provider_timeout'
    await admin.rpc('cali_fail_reviewer_generation', { p_request_id: input.requestId, p_user_id: user.id, p_reason: failureCategory })
    const shown = publicError(failureCategory)
    send(response, shown.status, { error: shown.message, category: failureCategory })
  }
}
