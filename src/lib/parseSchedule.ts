import { normalizeMeetingsForReview, type ParsedMeeting } from './scheduleValidation'
import { supabase } from './supabase'

export type { ParsedMeeting } from './scheduleValidation'

export async function parseScheduleFromOCR(ocrText: string): Promise<ParsedMeeting[]> {
  if (!supabase) throw new Error('Please sign in again to scan your form.')
  const { data: { session }, error: sessionError } = await supabase.auth.getSession()
  if (sessionError || !session?.access_token) throw new Error('Please sign in again to scan your form.')
  let res: Response
  try {
    res = await fetch('/api/parse-schedule', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ ocrText }),
      signal: AbortSignal.timeout(65000),
    })
  } catch (error) {
    console.error('[parse-schedule] request failed:', error)
    throw new Error('Finding your classes took too long. Please try again or add them manually.')
  }

  const body: unknown = await res.json().catch(() => null)
  if (!res.ok) {
    const error = body && typeof body === 'object' && 'error' in body ? body.error : null
    if (typeof error === 'string') throw new Error(error)
    if (res.status === 401) throw new Error('Please sign in again to scan your form.')
    if (res.status === 413) throw new Error('This form contains too much text. Try a closer photo of the class table.')
    throw new Error('We could not find your classes right now. Please try again or add them manually.')
  }
  if (!body || typeof body !== 'object' || !('meetings' in body)) {
    throw new Error('The schedule parser returned an invalid response.')
  }
  return normalizeMeetingsForReview(body.meetings)
}
