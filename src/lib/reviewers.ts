import type { JSONContent } from '@tiptap/react'

export type Reviewer = {
  id: string
  user_id: string
  subject_id: string | null
  title: string
  content: JSONContent
  plain_text: string
  revision: number
  created_at: string
  updated_at: string
  visibility?: 'private' | 'preview' | 'public'
  description?: string | null
  category?: string
  parent_reviewer_id?: string | null
  root_reviewer_id?: string | null
  original_author_id?: string | null
  original_author_username?: string | null
  published_at?: string | null
  moderated_at?: string | null
}

export type ReviewerSubject = { id: string; subject_code: string; title: string; color_key: string }

export const EMPTY_REVIEWER_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }

export function reviewerMatches(reviewer: Reviewer, query: string, subjectId: string): boolean {
  if (subjectId && reviewer.subject_id !== subjectId) return false
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return `${reviewer.title}\n${reviewer.plain_text}`.toLocaleLowerCase().includes(needle)
}

export function formatReviewerDate(value: string): string {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}
