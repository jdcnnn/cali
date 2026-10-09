import { createHash } from 'node:crypto'
import { GenerationError, generateAcademicReviewer } from '../../server/reviewerProvider.js'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createClient } from '@supabase/supabase-js'
import {
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
  if (category === 'policy_unavailable') return { status: 503, message: "Cali's AI providers are temporarily at capacity, so the academic content check could not finish. Wait a minute and try again. Your reviewed text is saved, and this attempt does not count toward your monthly limit." }
  if (category === 'content_blocked') return { status: 422, message: 'This material was blocked by the academic content policy. This attempt does not count toward your monthly limit.' }
  if (category === 'quota') return { status: 429, message: 'You have used all 10 reviewer generations for this month. Your limit resets next month.' }
  if (category === 'active') return { status: 409, message: 'Another reviewer is being generated. Wait for it to finish, then retry.' }
  if (category === 'provider_capacity') return { status: 503, message: "Cali's AI providers are temporarily at capacity. Wait a minute and try again. Your reviewed text is saved, and this attempt does not count toward your monthly limit." }
  if (category === 'provider_timeout') return { status: 504, message: "Cali's AI providers did not respond in time. Wait a minute and try again. Your reviewed text is saved, and this attempt does not count toward your monthly limit." }
  if (category === 'output_limit') return { status: 502, message: 'The reviewer was too long to finish. Choose Quick or shorten the extracted text, then try again.' }
  if (category === 'invalid_output') return { status: 502, message: 'The AI response could not be prepared as a reviewer. Your source is still here—please try again.' }
  return { status: 502, message: 'The generated reviewer could not be prepared. Your source is still here—please try again.' }
}

export default async function handler(request: IncomingMessage, response: ServerResponse) {
  if (request.method !== 'POST') { response.setHeader('Allow', 'POST'); send(response, 405, { error: 'Method not allowed.' }); return }
  const deadline = Date.now() + 110_000
  const boundedFetch: typeof fetch = (resource, init) => fetch(resource, { ...init, signal: AbortSignal.timeout(Math.max(1, Math.min(8_000, deadline - Date.now()))) })
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

  const authClient = createClient(supabaseUrl, anonKey, { auth: { persistSession: false }, global: { headers: { Authorization: authorization }, fetch: boundedFetch } })
  const { data: authData, error: authError } = await authClient.auth.getUser(authorization.slice(7))
  const user = authData.user
  if (authError || !user) { send(response, 401, { error: 'Your session has expired. Sign in and try again.' }); return }
  const hasGoogleIdentity = user.identities?.some(identity => identity.provider === 'google') === true
  if (!user.email_confirmed_at || !hasGoogleIdentity) { send(response, 403, { error: 'A verified Google account is required.' }); return }

  const { data: eligible, error: eligibilityError } = await authClient.rpc('cali_is_eligible_user')
  if (eligibilityError || eligible !== true) { send(response, 403, { error: 'This Google account is not currently eligible to use Cali.' }); return }

  const admin = createClient(supabaseUrl, serviceKey, { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: boundedFetch } })
  const { data: student } = await admin.from('students').select('user_id').eq('user_id', user.id).maybeSingle()
  if (!student) { send(response, 403, { error: 'Complete your Cali profile before using AI generation.' }); return }

  const { data: reservation, error: reservationError } = await admin.rpc('cali_reserve_reviewer_generation', {
    p_request_id: input.requestId, p_user_id: user.id, p_source_type: input.sourceType, p_detail: input.detail, p_prompt_version: REVIEWER_PROMPT_VERSION,
    p_input_hash: createHash('sha256').update(JSON.stringify({ sourceType: input.sourceType, sourceText: input.sourceText, detail: input.detail, preferences: input.preferences ?? null })).digest('hex'),
  })
  if (reservationError) {
    const category = reservationError.message.includes('PERSONAL_LIMIT') ? 'quota' : reservationError.message.includes('ALREADY_PROCESSING') ? 'active' : reservationError.message.includes('REQUEST_ID_CONFLICT') ? 'idempotent_replay' : 'database'
    const shown = publicError(category); send(response, shown.status, { error: shown.message, category }); return
  }
  const reserved = reservation as { action?: string; status?: string; draft?: unknown }
  if (reserved?.action === 'existing' && reserved.draft) { send(response, 200, reserved.draft); return }
  if (reserved?.action === 'existing' && reserved.status === 'processing') { send(response, 409, { error: 'This reviewer is still being generated. Wait a moment, then retry.', category: 'active' }); return }
  if (reserved?.action === 'existing') { send(response, 409, { error: 'This generation request was already submitted. Start a new request to retry.', category: 'idempotent_replay' }); return }

  let failureCategory = 'provider_error'
  try {
    const { generated, model, promptTokens, outputTokens } = await generateAcademicReviewer(input, openRouterKey, deadline)
    const converted = reviewerToTiptap(generated)
    const { error: completionError } = await admin.rpc('cali_complete_reviewer_generation', {
      p_request_id: input.requestId, p_user_id: user.id, p_model: model,
      p_prompt_tokens: promptTokens || null, p_output_tokens: outputTokens || null,
      p_title: generated.title, p_content: converted.content, p_plain_text: converted.plainText,
    })
    if (completionError) { failureCategory = 'database'; throw completionError }
    send(response, 200, { requestId: input.requestId, title: generated.title, content: converted.content, plainText: converted.plainText, revision: 1, expiresAt: new Date(Date.now() + 86_400_000).toISOString() })
  } catch (error) {
    if (error instanceof GenerationError) failureCategory = error.category
    else if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) failureCategory = 'provider_timeout'
    // A database response can be lost after completion commits. Recover the draft before marking failure.
    if (failureCategory === 'database') {
      const { data: draft } = await admin.from('generated_reviewer_drafts').select('request_id,title,content,plain_text,revision,expires_at').eq('request_id', input.requestId).eq('user_id', user.id).maybeSingle()
      if (draft) { send(response, 200, { requestId: draft.request_id, title: draft.title, content: draft.content, plainText: draft.plain_text, revision: draft.revision, expiresAt: draft.expires_at }); return }
    }
    const { error: failureError } = await admin.rpc('cali_fail_reviewer_generation', { p_request_id: input.requestId, p_user_id: user.id, p_reason: failureCategory })
    const shown = publicError(failureCategory)
    send(response, shown.status, { error: error instanceof GenerationError && error.category === 'content_blocked' ? error.message : shown.message, category: failureCategory, recoverable: !!failureError })
  }
}
