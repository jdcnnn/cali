import type { ApiRequest, ApiResponse } from '../../server/scheduleHttp.ts'
import { authenticatedClient, fail, readJson, send } from '../../server/scheduleHttp.ts'

export default async function handler(req: ApiRequest, res: ApiResponse) {
  if (req.method !== 'POST') return send(res, 405, { error: 'Method not allowed.' })
  try {
    const client = await authenticatedClient(req)
    if (!client) return send(res, 401, { error: 'Please sign in again.' })
    const body = await readJson(req)
    const input = body && typeof body === 'object' ? body as Record<string, unknown> : {}
    if (!Array.isArray(input.subjects) || input.subjects.length < 1 || input.subjects.length > 40 || !Number.isSafeInteger(input.expectedRevision)) return send(res, 400, { error: 'Invalid schedule proposal.' })
    const { data, error } = await client.rpc('cali_replace_weekly_schedule', { p_subjects: input.subjects, p_expected_revision: input.expectedRevision })
    if (error) return send(res, error.code === '40001' ? 409 : 400, { error: error.message })
    send(res, 200, { revision: data })
  } catch (error) { fail(res, error) }
}
