import { describe, expect, it } from 'vitest'
import { normalizeExtractedText, reviewerMatches, validateSourceText, type Reviewer } from './reviewers'

const reviewer = {
  id: '1', user_id: 'u', subject_id: 's', title: 'Cell Biology', plain_text: 'Mitochondria and ATP',
  content: { type: 'doc' }, origin: 'manual', ai_model: null, revision: 1,
  created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
} satisfies Reviewer

describe('reviewer helpers', () => {
  it('normalizes document whitespace without flattening paragraphs', () => {
    expect(normalizeExtractedText(' First\r\n\tline \n\n\n Second ')).toBe('First\n line\n\n Second')
  })

  it('validates meaningful source length and hard maximum', () => {
    expect(validateSourceText('a '.repeat(199))).toContain('at least')
    expect(validateSourceText('a'.repeat(200))).toBeNull()
    expect(validateSourceText('a'.repeat(120001))).toContain('fewer')
  })

  it('searches title and content while honoring the subject filter', () => {
    expect(reviewerMatches(reviewer, 'biology', 's')).toBe(true)
    expect(reviewerMatches(reviewer, 'ATP', 's')).toBe(true)
    expect(reviewerMatches(reviewer, 'ATP', 'other')).toBe(false)
  })
})
