import type { ReviewerSourceType } from './reviewers'

export type ExtractRequest = { id: string; buffer: ArrayBuffer; sourceType: Exclude<ReviewerSourceType, 'text'> }
export type ExtractResult =
  | { id: string; ok: true; text: string; pageCount?: number }
  | { id: string; ok: false; error: string }
