import type { VercelRequest, VercelResponse } from '@vercel/node'
import { OpenRouter } from '@openrouter/sdk'
import { createClient } from '@supabase/supabase-js'
import {
  generatedReviewerToTipTap,
  reviewerSystemPrompt,
  validateGeneratedReviewer,
  type ReviewerDetail,
} from '../../server/study.js'

const MAX_SOURCE_CHARS = 120_000
const MIN_SOURCE_CHARS = 200
const MAX_FOCUS_CHARS = 500
const REQUEST_TIMEOUT_MS = 108_000
const NVIDIA_STUDY_MODEL = 'nvidia/nemotron-3-super-120b-a12b:free'
const FREE_STUDY_FALLBACKS = [
  'dots-studio/dots-3-note-preview:free',
  'apodex/apodex-1.1-mini:free',
] as const

type RequestBody = {
  requestId?: string
  title?: string
  sourceText?: string
  sourceType?: 'pdf' | 'docx' | 'text'
  detail?: ReviewerDetail
  focus?: string
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

  const configuredModels = (process.env.OPENROUTER_STUDY_MODELS ?? '').split(',').map(model => model.trim()).filter(model => model.endsWith(':free'))
  const models = [...new Set([NVIDIA_STUDY_MODEL, ...configuredModels.filter(model => model !== NVIDIA_STUDY_MODEL), ...FREE_STUDY_FALLBACKS])]

  res.status(200)
  res.setHeader('Content-Type', 'application/x-ndjson; charset=utf-8')
  res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate')
  res.setHeader('X-Accel-Buffering', 'no')
  res.flushHeaders()
  const emit = (event: Record<string, unknown>) => res.write(`${JSON.stringify(event)}\n`)

  try {
    const userPrompt = [
      title ? `Preferred title: ${title}` : 'Choose a short, specific title from the material.',
      focus ? `Focus requested by the student: ${focus}` : '',
      'SOURCE MATERIAL:',
      sourceText,
    ].filter(Boolean).join('\n\n')

    const openRouter = new OpenRouter({ apiKey: openRouterKey })
    let reviewer: ReturnType<typeof validateGeneratedReviewer> | null = null
    let model = NVIDIA_STUDY_MODEL
    let lastModelError: unknown = null
    const generationDeadline = Date.now() + REQUEST_TIMEOUT_MS

    for (const [index, requestedModel] of models.entries()) {
      const remainingMs = generationDeadline - Date.now()
      if (remainingMs < 3_000) break
      const attemptsLeft = models.length - index
      const attemptTimeoutMs = index === 0
        ? Math.min(75_000, remainingMs - Math.max(0, attemptsLeft - 1) * 6_000)
        : Math.max(3_000, Math.floor(remainingMs / attemptsLeft))
      const displayName = requestedModel === NVIDIA_STUDY_MODEL ? 'NVIDIA Nemotron' : 'a backup free model'
      emit({ type: 'status', stage: index === 0 ? 'Waiting for NVIDIA Nemotron…' : `Trying ${displayName}…` })
      try {
        const stream = await openRouter.chat.send({
          httpReferer: `https://${String(req.headers['x-forwarded-host'] ?? req.headers.host ?? 'cali.app')}`,
          appTitle: 'Cali Study Reviewers',
          chatRequest: {
            model: requestedModel,
            messages: [
              { role: 'system', content: reviewerSystemPrompt(detail) },
              { role: 'user', content: userPrompt },
            ],
            temperature: 0.25,
            maxTokens: 10000,
            responseFormat: { type: 'json_object' },
            provider: { requireParameters: true, dataCollection: 'deny', allowFallbacks: true },
            stream: true,
          },
        }, { timeoutMs: attemptTimeoutMs })

        let raw = ''
        let receivedContent = false
        if (!(Symbol.asyncIterator in stream)) throw new Error('OpenRouter did not start a generation stream.')
        for await (const chunk of stream) {
          if (chunk.error) throw new Error(chunk.error.message)
          model = chunk.model || requestedModel
          const content = chunk.choices[0]?.delta?.content
          if (!content) continue
          if (!receivedContent) {
            receivedContent = true
            emit({ type: 'status', stage: `${displayName} is writing…` })
          }
          raw += content
          if (raw.length > 1_000_000) throw new Error('The generated reviewer was too large.')
        }
        if (!raw.trim()) throw new Error(`${displayName} returned an empty response.`)
        reviewer = validateGeneratedReviewer(cleanJson(raw))
        break
      } catch (modelError) {
        lastModelError = modelError
        console.warn('reviewer model attempt failed', requestedModel, modelError instanceof Error ? modelError.message.slice(0, 180) : '')
      }
    }
    if (!reviewer) throw lastModelError instanceof Error ? lastModelError : new Error('Every free model was unavailable.')

    emit({ type: 'status', stage: 'Structuring your preview…' })
    if (title) reviewer.title = title
    const document = generatedReviewerToTipTap(reviewer)
    if (document.plainText.length < 80) throw new Error('The generated reviewer was incomplete.')
    emit({ type: 'status', stage: 'Securing your private preview…' })
    const { error: completeError } = await admin.rpc('cali_complete_reviewer_generation', {
      p_request_id: body.requestId,
      p_user_id: authData.user.id,
      p_model: model,
      p_title: reviewer.title,
      p_content: document.content,
      p_plain_text: document.plainText,
    })
    if (completeError) throw new Error('Could not securely store the generated preview.')
    emit({ type: 'result', requestId: body.requestId, title: reviewer.title, content: document.content, model })
    return res.end()
  } catch (error) {
    const errorName = error instanceof Error ? error.name : ''
    const reason = /abort|timeout/i.test(errorName) ? 'timeout' : 'provider_failure'
    await admin.rpc('cali_fail_reviewer_generation', { p_request_id: body.requestId, p_user_id: authData.user.id, p_reason: reason })
    console.error('reviewer generation failed', reason, error instanceof Error ? error.message.slice(0, 240) : '')
    emit({ type: 'error', error: reason === 'timeout' ? 'Generation took too long. Try a shorter source.' : 'NVIDIA Nemotron could not create a reviewer this time. Please try again.' })
    return res.end()
  }
}
