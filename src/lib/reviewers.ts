import type { JSONContent } from '@tiptap/react'

export type ReviewerOrigin = 'manual' | 'ai'
export type ReviewerSourceType = 'pdf' | 'docx' | 'text'
export type ReviewerDetail = 'concise' | 'standard' | 'detailed'

export type Reviewer = {
  id: string
  user_id: string
  subject_id: string | null
  title: string
  content: JSONContent
  plain_text: string
  origin: ReviewerOrigin
  ai_model: string | null
  revision: number
  created_at: string
  updated_at: string
}

export type ReviewerSubject = { id: string; subject_code: string; title: string; color_key: string }

export type ReviewerAiDraft = {
  request_id: string
  user_id: string
  title: string
  content: JSONContent
  plain_text: string
  expires_at: string
  created_at: string
}

export const EMPTY_REVIEWER_DOCUMENT: JSONContent = { type: 'doc', content: [{ type: 'paragraph' }] }
export const REVIEWER_MAX_FILE_BYTES = 10 * 1024 * 1024
export const REVIEWER_MAX_PDF_PAGES = 100
export const REVIEWER_MAX_SOURCE_CHARS = 120_000
export const REVIEWER_MIN_SOURCE_CHARS = 200
export const REVIEWER_EXTRACTION_TIMEOUT_MS = 20_000

export function normalizeExtractedText(value: string): string {
  return value
    .replace(/\r\n?/g, '\n')
    .replace(/[\t\u00a0]+/g, ' ')
    .replace(/ +\n/g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
}

export function validateSourceText(value: string): string | null {
  const meaningful = value.replace(/\s/g, '')
  if (meaningful.length < REVIEWER_MIN_SOURCE_CHARS) return `Add at least ${REVIEWER_MIN_SOURCE_CHARS} characters of meaningful text.`
  if (value.length > REVIEWER_MAX_SOURCE_CHARS) return `Source text must be ${REVIEWER_MAX_SOURCE_CHARS.toLocaleString()} characters or fewer.`
  return null
}

export function reviewerMatches(reviewer: Reviewer, query: string, subjectId: string): boolean {
  if (subjectId && reviewer.subject_id !== subjectId) return false
  const needle = query.trim().toLocaleLowerCase()
  if (!needle) return true
  return `${reviewer.title}\n${reviewer.plain_text}`.toLocaleLowerCase().includes(needle)
}

export function formatReviewerDate(value: string): string {
  return new Intl.DateTimeFormat('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value))
}
