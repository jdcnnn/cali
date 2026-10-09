import { buildAcademicPolicyBody, parsePolicyDecision, policyMessage } from './reviewerPolicy.js'
import { buildOpenRouterReviewerBody, getReviewerModels, parseGeneratedReviewerResponse, prepareGeneratedReviewer, validateReviewerQuality, type ReviewerGenerationInput } from './reviewerGeneration.js'

export class GenerationError extends Error {
  constructor(readonly category: string, message?: string) { super(message ?? category) }
}
type ProviderResult = { model?: string; usage?: { prompt_tokens?: number; completion_tokens?: number }; choices?: { finish_reason?: string; message?: { content?: unknown; parsed?: unknown } }[] }
export async function generateAcademicReviewer(input: ReviewerGenerationInput, key: string, deadline: number, fetcher: typeof fetch = fetch) {
  let promptTokens = 0
  let outputTokens = 0
  async function call(body: unknown, maximumMs: number, reserveMs: number): Promise<ProviderResult> {
    const remaining = Math.min(maximumMs, deadline - Date.now() - reserveMs)
    if (remaining <= 0) throw new GenerationError('provider_timeout')
    try {
      const response = await fetcher('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(remaining),
        headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', 'HTTP-Referer': 'https://cali-class-ally.vercel.app', 'X-Title': 'Cali Study Reviewer' },
        body: JSON.stringify(body),
      })
      if (!response.ok) throw new GenerationError([408, 429].includes(response.status) || response.status >= 500 ? 'provider_capacity' : 'provider_error')
      const result = await response.json() as ProviderResult
      promptTokens += result.usage?.prompt_tokens ?? 0
      outputTokens += result.usage?.completion_tokens ?? 0
      return result
    } catch (error) {
      if (error instanceof GenerationError) throw error
      if (error instanceof Error && ['AbortError', 'TimeoutError'].includes(error.name)) throw new GenerationError('provider_timeout')
      throw new GenerationError('provider_error')
    }
  }
  async function checkPolicy(material: unknown, stage: 'input' | 'output') {
    const reserveMs = stage === 'input' ? 35_000 : 6_000
    const policyDeadline = Math.min(deadline - reserveMs, Date.now() + 16_000)
    for (const [index, model] of getReviewerModels().entries()) {
      const remaining = policyDeadline - Date.now()
      if (remaining <= 0) break
      let result: ProviderResult
      try { result = await call(buildAcademicPolicyBody(material, stage, model), Math.min(index === 0 ? 9_000 : 7_000, remaining), reserveMs) }
      catch (error) {
        console.warn('Academic policy provider failed.', { stage, model, category: error instanceof GenerationError ? error.category : 'provider_error' })
        continue
      }
      const choice = result.choices?.[0]
      const decision = parsePolicyDecision(choice?.message?.parsed ?? choice?.message?.content)
      if (!decision || choice?.finish_reason === 'length') {
        console.warn('Academic policy response was invalid.', { stage, model: result.model ?? model, finishReason: choice?.finish_reason })
        continue
      }
      if (!decision.allowed) throw new GenerationError('content_blocked', policyMessage(decision.category))
      return
    }
    throw new GenerationError('policy_unavailable')
  }
  // Both source and requested additions are checked in full; never persist either.
  await checkPolicy({ source: input.sourceText, preferences: input.preferences }, 'input')
  let lastError = new GenerationError('invalid_output')
  for (const retry of [false, true]) {
    let provider: ProviderResult
    try { provider = await call(buildOpenRouterReviewerBody(input.sourceText, input.detail, retry, input.preferences), retry ? 35_000 : 50_000, 21_000) }
    catch (error) {
      lastError = error instanceof GenerationError ? error : new GenerationError('provider_error')
      if (lastError.category === 'provider_error') throw lastError
      continue
    }
    const choice = provider.choices?.[0]
    const parsed = parseGeneratedReviewerResponse(choice?.message?.parsed ?? choice?.message?.content)
    const generated = parsed ? prepareGeneratedReviewer(parsed, input.detail) : null
    if (choice?.finish_reason === 'length' || !generated || !validateReviewerQuality(generated, input.detail)) {
      lastError = new GenerationError(choice?.finish_reason === 'length' ? 'output_limit' : 'invalid_output')
      console.warn('Reviewer validation failed.', { attempt: retry ? 'fallback' : 'primary', model: provider.model, finishReason: choice?.finish_reason, stage: !parsed ? 'schema' : !generated ? 'preparation' : 'quality' })
      continue
    }
    await checkPolicy(generated, 'output')
    return { generated, model: provider.model ?? 'unknown', promptTokens, outputTokens }
  }
  throw lastError
}
