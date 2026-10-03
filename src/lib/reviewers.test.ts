import { describe, expect, it } from 'vitest'
import { reviewerMatches, type Reviewer } from './reviewers'

const reviewer = {
  id: '1', user_id: 'u', subject_id: 's', title: 'Cell Biology', plain_text: 'Mitochondria and ATP',
  content: { type: 'doc' }, revision: 1,
  created_at: '2026-10-03T00:00:00Z', updated_at: '2026-10-03T00:00:00Z',
} satisfies Reviewer

describe('reviewer helpers', () => {
  it('searches title and content while honoring the subject filter', () => {
    expect(reviewerMatches(reviewer, 'biology', 's')).toBe(true)
    expect(reviewerMatches(reviewer, 'ATP', 's')).toBe(true)
    expect(reviewerMatches(reviewer, 'ATP', 'other')).toBe(false)
  })
})
