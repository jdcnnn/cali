import { describe, expect, it } from 'vitest'
import { clearReviewerRecovery, readReviewerRecovery, reviewerSubmissionKey, writeReviewerRecovery, type ReviewerRecovery } from './reviewerRecovery'
import { DEFAULT_REVIEWER_PREFERENCES } from './reviewerPreferences'
function storage() {
  const data = new Map<string, string>()
  return { get length() { return data.size }, getItem: (k: string) => data.get(k) ?? null, setItem: (k: string, v: string) => { data.set(k, v) }, removeItem: (k: string) => { data.delete(k) }, key: (i: number) => [...data.keys()][i] ?? null, clear: () => data.clear() } as Storage
}
const value: ReviewerRecovery = { sourceType: 'pdf', sourceText: 'Academic notes', detail: 'standard', preferences: DEFAULT_REVIEWER_PREFERENCES, requestId: '6b5ad38b-8f1e-4a86-82b6-849076b980ed', expiresAt: Date.now() + 60_000 }
describe('account-scoped reviewer recovery', () => {
  it('restores a request only for its owner and preserves all generation settings', () => {
    const store = storage()
    writeReviewerRecovery('student-a', value, store)
    expect(readReviewerRecovery('student-b', store)).toBeNull()
    expect(readReviewerRecovery('student-a', store)).toEqual(value)
  })
  it('removes expired recovery and unscoped legacy source text', () => {
    const store = storage()
    store.setItem('cali-ai-reviewer-recovery', 'legacy private notes')
    writeReviewerRecovery('student-a', { ...value, expiresAt: Date.now() - 1 }, store)
    expect(readReviewerRecovery('student-a', store)).toBeNull()
    expect(store.length).toBe(0)
  })
  it('clears recovery on sign-out without deleting unrelated preferences', () => {
    const store = storage()
    writeReviewerRecovery('student-a', value, store)
    writeReviewerRecovery('student-b', value, store)
    store.setItem('cali-theme', 'dark')
    clearReviewerRecovery(undefined, store)
    expect(store.length).toBe(1)
    expect(store.getItem('cali-theme')).toBe('dark')
  })
  it('changes request identity when reviewer preferences change', () => {
    expect(reviewerSubmissionKey(value)).not.toBe(reviewerSubmissionKey({ ...value, preferences: { ...value.preferences, additionalContent: 'Include comparisons' } }))
  })
  it('rejects malformed persisted instructions', () => {
    const store = storage()
    store.setItem('cali-ai-reviewer-recovery:student-a', JSON.stringify({ ...value, preferences: { ...value.preferences, additionalContent: 'x'.repeat(2001) } }))
    expect(readReviewerRecovery('student-a', store)).toBeNull()
  })
})
