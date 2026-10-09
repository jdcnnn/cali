import { parseReviewerPreferences, type ReviewerPreferences } from './reviewerPreferences'
export type ReviewerRecovery = {
  sourceType: 'pdf' | 'scan'; sourceText: string; detail: 'concise' | 'standard' | 'detailed'
  preferences: ReviewerPreferences; requestId: string | null; expiresAt: number
}
const PREFIX = 'cali-ai-reviewer-recovery:'
export function readReviewerRecovery(userId: string, storage: Storage = window.localStorage): ReviewerRecovery | null {
  try {
    // The old unscoped value cannot be attributed to an account safely.
    storage.removeItem('cali-ai-reviewer-recovery')
    const key = PREFIX + userId
    const value = JSON.parse(storage.getItem(key) ?? 'null') as ReviewerRecovery | null
    const preferences = parseReviewerPreferences(value?.preferences)
    if (!value || !preferences || !Number.isFinite(value.expiresAt) || value.expiresAt <= Date.now()
      || typeof value.sourceText !== 'string' || !value.sourceText.trim() || value.sourceText.length > 100_000
      || !['pdf', 'scan'].includes(value.sourceType) || !['concise', 'standard', 'detailed'].includes(value.detail)
      || (value.requestId !== null && (typeof value.requestId !== 'string' || !/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.requestId)))) {
      storage.removeItem(key); return null
    }
    return { ...value, preferences }
  } catch { return null }
}
export function writeReviewerRecovery(userId: string, value: ReviewerRecovery, storage: Storage = window.localStorage) {
  try { storage.setItem(PREFIX + userId, JSON.stringify(value)) } catch { /* Storage is optional; keep the in-memory submission. */ }
}
export function clearReviewerRecovery(userId?: string, storage: Storage = window.localStorage) {
  try {
    storage.removeItem('cali-ai-reviewer-recovery')
    if (userId) { storage.removeItem(PREFIX + userId); return }
    const keys = Array.from({ length: storage.length }, (_, i) => storage.key(i)).filter((key): key is string => !!key && key.startsWith(PREFIX))
    for (const key of keys) storage.removeItem(key)
  } catch { /* Unavailable storage must not prevent sign-out. */ }
}
export function reviewerSubmissionKey(value: Pick<ReviewerRecovery, 'sourceType' | 'sourceText' | 'detail' | 'preferences'>) {
  return JSON.stringify({ sourceType: value.sourceType, sourceText: value.sourceText.trim(), detail: value.detail, preferences: value.preferences })
}
