import { Readable } from 'node:stream'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
const mocks = vi.hoisted(() => ({ getUser: vi.fn(), rpc: vi.fn(), maybeSingle: vi.fn(), generate: vi.fn() }))
vi.mock('@supabase/supabase-js', () => ({ createClient: () => ({ auth: { getUser: mocks.getUser }, rpc: (name: string, args: unknown) => name === 'cali_is_eligible_user' ? Promise.resolve({ data: true, error: null }) : mocks.rpc(name, args), from: () => { const query = { select: () => query, eq: () => query, maybeSingle: mocks.maybeSingle }; return query } }) }))
vi.mock('../../server/reviewerProvider.js', async importOriginal => ({ ...await importOriginal<typeof import('../../server/reviewerProvider')>(), generateAcademicReviewer: mocks.generate }))
import handler from './reviewer-generation'
import { GenerationError } from '../../server/reviewerProvider'
const input = { requestId: '6b5ad38b-8f1e-4a86-82b6-849076b980ed', sourceType: 'pdf', sourceText: 'Cells contain membranes.', detail: 'concise' }
async function invoke(method = 'POST', authenticated = true, body = input) {
  const request = Readable.from([Buffer.from(JSON.stringify(body))]) as IncomingMessage
  request.method = method; request.headers = authenticated ? { authorization: 'Bearer test-token' } : {}
  const response = { statusCode: 0, setHeader: vi.fn(), end: vi.fn() }
  await handler(request, response as unknown as ServerResponse)
  return { status: response.statusCode, body: JSON.parse(response.end.mock.calls[0][0]) }
}
describe('reviewer generation endpoint', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    for (const name of ['SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'OPENROUTER_API_KEY']) vi.stubEnv(name, name === 'SUPABASE_URL' ? 'https://test.supabase.co' : 'test-key')
    mocks.getUser.mockResolvedValue({ data: { user: { id: 'student-a', email: 'student@rtu.edu.ph', email_confirmed_at: '2026-10-08', identities: [{ provider: 'google' }] } }, error: null })
    mocks.maybeSingle.mockResolvedValue({ data: { user_id: 'student-a' }, error: null })
    mocks.rpc.mockImplementation(async name => ({ data: name === 'cali_reserve_reviewer_generation' ? { action: 'reserved' } : null, error: null }))
    mocks.generate.mockResolvedValue({ generated: { title: 'Cells', sections: [{ heading: 'Cells', basis: 'source', blocks: [{ type: 'paragraph', text: 'Cells contain membranes.' }] }] }, model: 'test:free', promptTokens: 10, outputTokens: 5 })
  })
  afterEach(() => vi.unstubAllEnvs())
  it('requires authentication and rejects unsupported methods', async () => {
    expect((await invoke('POST', false)).status).toBe(401)
    expect((await invoke('GET')).status).toBe(405)
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('rejects ineligible accounts before reserving quota', async () => {
    mocks.getUser.mockResolvedValueOnce({ data: { user: { email: 'student@example.com', identities: [], email_confirmed_at: 'today' } }, error: null })
    expect((await invoke()).status).toBe(403)
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('marks blocked requests failed without creating a draft', async () => {
    mocks.generate.mockRejectedValueOnce(new GenerationError('content_blocked', 'Generation blocked for harassment.'))
    const result = await invoke()
    expect(result.status).toBe(422)
    expect(result.body.category).toBe('content_blocked')
    expect(mocks.rpc).toHaveBeenCalledWith('cali_fail_reviewer_generation', expect.objectContaining({ p_reason: 'content_blocked' }))
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'cali_complete_reviewer_generation')).toBe(false)
  })
  it('explains temporary provider capacity without implying quota was used', async () => {
    mocks.generate.mockRejectedValueOnce(new GenerationError('policy_unavailable'))
    const result = await invoke()
    expect(result.status).toBe(503)
    expect(result.body).toMatchObject({ category: 'policy_unavailable', recoverable: false })
    expect(result.body.error).toContain('temporarily at capacity')
    expect(result.body.error).toContain('reviewed text is saved')
    expect(result.body.error).toContain('does not count toward your monthly limit')
  })
  it('deduplicates an existing successful request without calling the provider', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { action: 'existing', status: 'succeeded', draft: { requestId: input.requestId, title: 'Recovered' } }, error: null })
    const result = await invoke()
    expect(result.body.title).toBe('Recovered')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('returns an active request without launching another generation', async () => {
    mocks.rpc.mockResolvedValueOnce({ data: { action: 'existing', status: 'processing' }, error: null })
    expect((await invoke()).body.category).toBe('active')
    expect(mocks.generate).not.toHaveBeenCalled()
  })
  it('binds request identity to a fingerprint without persisting source text', async () => {
    expect((await invoke()).status).toBe(200)
    const args = mocks.rpc.mock.calls.find(([name]) => name === 'cali_reserve_reviewer_generation')?.[1]
    expect(args.p_input_hash).toMatch(/^[a-f0-9]{64}$/)
    expect(args).not.toHaveProperty('sourceText')
    expect(args).not.toHaveProperty('preferences')
  })
  it('recovers a committed draft after a lost completion response', async () => {
    mocks.rpc.mockImplementation(async name => ({ data: name === 'cali_reserve_reviewer_generation' ? { action: 'reserved' } : null, error: name === 'cali_complete_reviewer_generation' ? { message: 'network error' } : null }))
    mocks.maybeSingle.mockResolvedValueOnce({ data: { user_id: 'student-a' } }).mockResolvedValueOnce({ data: { request_id: input.requestId, title: 'Committed draft', revision: 1 } })
    const result = await invoke()
    expect(result.status).toBe(200)
    expect(result.body.title).toBe('Committed draft')
    expect(mocks.rpc.mock.calls.some(([name]) => name === 'cali_fail_reviewer_generation')).toBe(false)
  })
})
