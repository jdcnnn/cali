export type ReviewerPreferences = {
  sourceFaithful: boolean
  examples: 'none' | 'some' | 'many'
  comparisons: boolean
  commonMistakes: boolean
  memoryAids: boolean
  selfCheck: boolean
  presentation: 'mixed' | 'bullets' | 'explanatory'
  allowSupplementaryExamples: boolean
}
export const DEFAULT_REVIEWER_PREFERENCES: ReviewerPreferences = {
  sourceFaithful: true,
  examples: 'some',
  comparisons: false,
  commonMistakes: false,
  memoryAids: false,
  selfCheck: false,
  presentation: 'mixed',
  allowSupplementaryExamples: true,
}
export function parseReviewerPreferences(value: unknown): ReviewerPreferences | null {
  if (value === undefined) return { ...DEFAULT_REVIEWER_PREFERENCES }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const item = value as Record<string, unknown>
  // Older open clients only send additionalContent. Ignore that retired field
  // and migrate the request to safe structured defaults instead of rejecting it.
  if (item.additionalContent !== undefined && (typeof item.additionalContent !== 'string' || item.additionalContent.length > 2000)) return null
  const examples = item.examples ?? DEFAULT_REVIEWER_PREFERENCES.examples
  const presentation = item.presentation ?? DEFAULT_REVIEWER_PREFERENCES.presentation
  if (!['none', 'some', 'many'].includes(String(examples)) || !['mixed', 'bullets', 'explanatory'].includes(String(presentation))) return null
  if (item.sourceFaithful !== undefined && typeof item.sourceFaithful !== 'boolean') return null
  for (const key of ['comparisons', 'commonMistakes', 'memoryAids', 'selfCheck', 'allowSupplementaryExamples'] as const) {
    if (item[key] !== undefined && typeof item[key] !== 'boolean') return null
  }
  return {
    sourceFaithful: typeof item.sourceFaithful === 'boolean' ? item.sourceFaithful : DEFAULT_REVIEWER_PREFERENCES.sourceFaithful,
    examples: examples as ReviewerPreferences['examples'],
    comparisons: typeof item.comparisons === 'boolean' ? item.comparisons : DEFAULT_REVIEWER_PREFERENCES.comparisons,
    commonMistakes: typeof item.commonMistakes === 'boolean' ? item.commonMistakes : DEFAULT_REVIEWER_PREFERENCES.commonMistakes,
    memoryAids: typeof item.memoryAids === 'boolean' ? item.memoryAids : DEFAULT_REVIEWER_PREFERENCES.memoryAids,
    selfCheck: typeof item.selfCheck === 'boolean' ? item.selfCheck : DEFAULT_REVIEWER_PREFERENCES.selfCheck,
    presentation: presentation as ReviewerPreferences['presentation'],
    allowSupplementaryExamples: typeof item.allowSupplementaryExamples === 'boolean' ? item.allowSupplementaryExamples : DEFAULT_REVIEWER_PREFERENCES.allowSupplementaryExamples,
  }
}
