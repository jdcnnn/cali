import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import {
  generatedReviewerToTipTap,
  reviewerJsonSchema,
  reviewerSystemPrompt,
  validateGeneratedReviewer,
  type ReviewerDetail,
} from '../../server/study.js'

const MAX_SOURCE_CHARS = 120_000
const MIN_SOURCE_CHARS = 200
const MAX_FOCUS_CHARS = 500
const REQUEST_TIMEOUT_MS = 110_000

type RequestBody = {
  requestId?: string
  title?: string
  sourceText?: string
  sourceType?: 'pdf' | 'docx' | 'text'
  detail?: ReviewerDetail
  focus?: string
  privacyAccepted?: boolean
}

type OpenRouterResponse = {
  model?: string
  choices?: Array<{ message?: { content?: string } }>
  error?: { message?: string }
}

function send(res: VercelResponse, status: number, payload: Record<string, unknown>) {
  res.setHeader('Cache-Control', 'no-store')
  return res.status(status).json(payload)
}

function originAllowed(req: VercelRequest): boolean {
  const origin = req.headers.origin
  if (!origin) return true
  try {
    const forwardedHost = String(req.headers['x-forwarded-host'] ?? req.headers.host ?? '')
    return new URL(origin).host === forwardedHost
  } catch {
    return false
  }
}

function cleanJson(raw: string): unknown {
  const cleaned = raw.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
  return JSON.parse(cleaned)
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method === 'OPTIONS') return originAllowed(req) ? res.status(204).end() : res.status(403).end()
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  if (!originAllowed(req)) return send(res, 403, { error: 'This request is not allowed.' })
  if (process.env.STUDY_AI_ENABLED !== 'true') return send(res, 503, { error: 'AI reviewer generation is not enabled yet.' })

  const supabaseUrl = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const openRouterKey = process.env.OPENROUTER_STUDY_KEY
  if (!supabaseUrl || !secretKey || !openRouterKey) return send(res, 503, { error: 'AI reviewer generation is not configured.' })

  const authHeader = req.headers.authorization
  if (!authHeader?.startsWith('Bearer ')) return send(res, 401, { error: 'Session expired. Please sign in again.' })

  const admin = createClient(supabaseUrl, secretKey, { auth: { persistSession: false, autoRefreshToken: false } })
  const { data: authData, error: authError } = await admin.auth.getUser(authHeader.slice(7))
  if (authError || !authData.user) return send(res, 401, { error: 'Session expired. Please sign in again.' })

  const body = (req.body ?? {}) as RequestBody
  const sourceText = typeof body.sourceText === 'string' ? body.sourceText.trim() : ''
  const title = typeof body.title === 'string' ? body.title.trim().slice(0, 160) : ''
  const focus = typeof body.focus === 'string' ? body.focus.trim().slice(0, MAX_FOCUS_CHARS) : ''
  const sourceType = body.sourceType
  const detail = body.detail
  if (!body.privacyAccepted) return send(res, 400, { error: 'Please accept the privacy notice before generating.' })
  if (!body.requestId || !/^[0-9a-f-]{36}$/i.test(body.requestId)) return send(res, 400, { error: 'Invalid generation request.' })
  if (!sourceType || !['pdf', 'docx', 'text'].includes(sourceType)) return send(res, 400, { error: 'Choose a supported source.' })
  if (!detail || !['concise', 'standard', 'detailed'].includes(detail)) return send(res, 400, { error: 'Choose a valid detail level.' })
  if (sourceText.length < MIN_SOURCE_CHARS) return send(res, 400, { error: `Add at least ${MIN_SOURCE_CHARS} characters of meaningful source text.` })
  if (sourceText.length > MAX_SOURCE_CHARS) return send(res, 413, { error: `Source text must be ${MAX_SOURCE_CHARS.toLocaleString()} characters or fewer.` })

  const { error: studentError } = await admin.from('students').select('user_id').eq('user_id', authData.user.id).single()
  if (studentError) return send(res, 403, { error: 'A completed Cali student profile is required.' })

  const { error: reserveError } = await admin.rpc('cali_reserve_reviewer_generation', {
    p_request_id: body.requestId,
    p_user_id: authData.user.id,
    p_source_type: sourceType,
    p_detail: detail,
  })
  if (reserveError) {
    const message = reserveError.message ?? ''
    if (message.includes('PERSONAL_LIMIT')) return send(res, 429, { error: 'You have used your 10 free AI reviewers for this month.' })
    if (message.includes('GLOBAL_LIMIT')) return send(res, 429, { error: 'Cali’s free AI capacity is full for today. Try again tomorrow.' })
    if (message.includes('ALREADY_PROCESSING')) return send(res, 409, { error: 'A reviewer is already being generated for your account.' })
    console.error('reviewer generation reservation failed', reserveError.code)
    return send(res, 500, { error: 'Could not start reviewer generation.' })
  }

  const models = (process.env.OPENROUTER_STUDY_MODELS ?? '').split(',').map(model => model.trim()).filter(model => model.endsWith(':free'))
  if (!models.length) {
    await admin.rpc('cali_fail_reviewer_generation', { p_request_id: body.requestId, p_user_id: authData.user.id, p_reason: 'no_free_models' })
    return send(res, 503, { error: 'No free study model is configured.' })
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const userPrompt = [
      title ? `Preferred title: ${title}` : 'Choose a short, specific title from the material.',
      focus ? `Focus requested by the student: ${focus}` : '',
      'SOURCE MATERIAL:',
      sourceText,
    ].filter(Boolean).join('\n\n')

    const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
      method: 'POST', signal: controller.signal,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${openRouterKey}`,
        'HTTP-Referer': `https://${String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'cali.app')}`,
        'X-Title': 'Cali Study Reviewers',
      },
      body: JSON.stringify({
        models,
        messages: [
          { role: 'system', content: reviewerSystemPrompt(detail) },
          { role: 'user', content: userPrompt },
        ],
        temperature: 0.25,
        max_tokens: 10000,
        response_format: { type: 'json_schema', json_schema: reviewerJsonSchema },
        provider: { require_parameters: true, data_collection: 'deny' },
      }),
    })
    const result = await response.json() as OpenRouterResponse
    const raw = result.choices?.[0]?.message?.content
    if (!response.ok || !raw) throw new Error(result.error?.message || `Provider error ${response.status}`)
    const reviewer = validateGeneratedReviewer(cleanJson(raw))
    if (title) reviewer.title = title
    const document = generatedReviewerToTipTap(reviewer)
    if (document.plainText.length < 80) throw new Error('The generated reviewer was incomplete.')
    const model = result.model ?? models[0]

    const { error: completeError } = await admin.rpc('cali_complete_reviewer_generation', {
      p_request_id: body.requestId,
      p_user_id: authData.user.id,
      p_model: model,
      p_title: reviewer.title,
      p_content: document.content,
      p_plain_text: document.plainText,
    })
    if (completeError) throw new Error('Could not securely store the generated preview.')
    return send(res, 200, { requestId: body.requestId, title: reviewer.title, content: document.content, model })
  } catch (error) {
    const reason = error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'provider_failure'
    await admin.rpc('cali_fail_reviewer_generation', { p_request_id: body.requestId, p_user_id: authData.user.id, p_reason: reason })
    console.error('reviewer generation failed', reason)
    return send(res, reason === 'timeout' ? 504 : 502, { error: reason === 'timeout' ? 'Generation took too long. Try a shorter source.' : 'The free AI provider could not create a reviewer this time. Please try again.' })
  } finally {
    clearTimeout(timer)
  }
}
