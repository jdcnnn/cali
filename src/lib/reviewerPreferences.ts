export type ReviewerPreferences = {
  additionalContent: string
}
export const DEFAULT_REVIEWER_PREFERENCES: ReviewerPreferences = {
  additionalContent: '',
}
export function parseReviewerPreferences(value: unknown): ReviewerPreferences | null {
  if (value === undefined) return { ...DEFAULT_REVIEWER_PREFERENCES }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  if (typeof item.additionalContent !== 'string' || item.additionalContent.length > 2000) return null
  // Ignore retired style, knowledge, description, and styleNotes fields from older clients.
  return { additionalContent: item.additionalContent.trim() }
}
