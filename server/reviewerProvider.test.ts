import { describe, expect, it, vi } from 'vitest'
import { generateAcademicReviewer } from './reviewerProvider'
import type { ReviewerGenerationInput } from './reviewerGeneration'
import { DEFAULT_REVIEWER_PREFERENCES } from '../src/lib/reviewerPreferences'
const preferences = { ...DEFAULT_REVIEWER_PREFERENCES, examples: 'none' as const, presentation: 'bullets' as const }
const input: ReviewerGenerationInput = { requestId: '6b5ad38b-8f1e-4a86-82b6-849076b980ed', sourceType: 'pdf', sourceText: 'Cells contain membranes.', detail: 'concise', preferences }
const safe = { allowed: true, category: 'allowed' }
const reviewer = { title: 'Cells', sections: [{ heading: 'Membranes', blocks: [{ type: 'key_points', basis: 'source', items: ['Cells have membranes.'] }, { type: 'key_points', basis: 'source', items: ['Membranes form a boundary.'] }] }] }
const reviewerWithExamples = { title: 'Cells', sections: [{ heading: 'Membranes', blocks: [{ type: 'key_points', basis: 'source', items: ['Cells have membranes.'] }, { type: 'explanation', basis: 'source', text: 'The membrane forms a boundary.' }, { type: 'example', basis: 'supplementary', scenario: 'A gated boundary', explanation: 'The gate illustrates selective movement.' }] }, { heading: 'Applications', blocks: [{ type: 'example', basis: 'supplementary', scenario: 'A selective filter', explanation: 'A filter illustrates controlled passage.' }] }] }
const response = (value: unknown, finishReason = 'stop') => new Response(JSON.stringify({ model: 'test:free', choices: [{ finish_reason: finishReason, message: { content: JSON.stringify(value) } }], usage: { prompt_tokens: 10, completion_tokens: 5 } }))
describe('reviewer provider lifecycle', () => {
  it('blocks a flagged source before making any generation call', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ allowed: false, category: 'harassment' }))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).rejects.toMatchObject({ category: 'content_blocked' })
    expect(fetcher).toHaveBeenCalledOnce()
  })
  it('does not bypass an unavailable policy check', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(new Response('', { status: 503 }))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).rejects.toMatchObject({ category: 'policy_unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('does not accept malformed policy output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response({ allowed: true }))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).rejects.toMatchObject({ category: 'policy_unavailable' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })
  it('retries malformed policy output with the second model', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response({ allowed: true })).mockResolvedValueOnce(response(safe)).mockResolvedValueOnce(response(reviewer)).mockResolvedValueOnce(response(safe))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).resolves.toMatchObject({ generated: reviewer })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('checks generated content before releasing a draft', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(safe)).mockResolvedValueOnce(response(reviewer)).mockResolvedValueOnce(response({ allowed: false, category: 'sexual' }))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).rejects.toMatchObject({ category: 'content_blocked' })
    expect(fetcher).toHaveBeenCalledTimes(3)
  })
  it('falls back after a capacity error and checks the final output', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(safe)).mockResolvedValueOnce(new Response('', { status: 429 })).mockResolvedValueOnce(response(reviewer)).mockResolvedValueOnce(response(safe))
    const result = await generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)
    expect(result.generated).toEqual(reviewer)
    expect(result.promptTokens).toBe(30)
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('retries truncated output even if it contains a valid-looking object', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(safe)).mockResolvedValueOnce(response(reviewer, 'length')).mockResolvedValueOnce(response(reviewer)).mockResolvedValueOnce(response(safe))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).resolves.toMatchObject({ generated: reviewer })
    expect(fetcher).toHaveBeenCalledTimes(4)
  })
  it('retries a structurally valid draft that misses selected examples', async () => {
    const requested: ReviewerGenerationInput = { ...input, detail: 'standard', preferences: { ...DEFAULT_REVIEWER_PREFERENCES, sourceFaithful: false } }
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(safe)).mockResolvedValueOnce(response(reviewer)).mockResolvedValueOnce(response(reviewerWithExamples)).mockResolvedValueOnce(response(safe))
    const result = await generateAcademicReviewer(requested, 'test-key', Date.now() + 110_000, fetcher)
    expect(result.generated).toEqual(reviewerWithExamples)
    const fallbackBody = JSON.parse(String(fetcher.mock.calls[2]?.[1]?.body)) as { messages: { content: string }[] }
    expect(fallbackBody.messages[1]?.content).toContain('Provide at least 2 example blocks; found 0.')
  })
  it('blocks unchecked output if the final policy gate is unavailable', async () => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValueOnce(response(safe)).mockResolvedValueOnce(response(reviewer)).mockRejectedValueOnce(new Error('network failure'))
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() + 110_000, fetcher)).rejects.toMatchObject({ category: 'policy_unavailable' })
  })
  it('does not issue requests after the total time budget has expired', async () => {
    const fetcher = vi.fn<typeof fetch>()
    await expect(generateAcademicReviewer(input, 'test-key', Date.now() - 1, fetcher)).rejects.toMatchObject({ category: 'policy_unavailable' })
    expect(fetcher).not.toHaveBeenCalled()
  })
})
