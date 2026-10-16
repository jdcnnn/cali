import type { JSONContent } from '@tiptap/react'

const nodes = new Set(['doc', 'paragraph', 'heading', 'text', 'hardBreak', 'horizontalRule', 'bulletList', 'orderedList', 'listItem', 'taskList', 'taskItem', 'blockquote', 'codeBlock', 'table', 'tableRow', 'tableCell', 'tableHeader', 'columns', 'column'])
const marks = new Set(['bold', 'italic', 'underline', 'strike', 'code', 'link', 'textStyle', 'highlight'])
const object = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value)

export function safeReviewerLink(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.length > 2048 || Array.from(value).some(character => character.charCodeAt(0) <= 32 || character.charCodeAt(0) === 127 || character === '\\')) return undefined
  if (/^(?:https?:\/\/|mailto:)/i.test(value)) return value
  if (/^(?:\/(?!\/)|#)/.test(value)) return value
  return undefined
}

// Keep this structural contract aligned with cali_valid_reviewer_document.
// Unknown attributes are retained for existing Tiptap formatting, never HTML.
export function isReviewerDocument(value: unknown): value is JSONContent {
  if (!object(value) || value.type !== 'doc' || !Array.isArray(value.content)) return false
  const pending: { node: unknown; depth: number }[] = [{ node: value, depth: 0 }]
  let count = 0
  while (pending.length) {
    const { node, depth } = pending.pop()!
    if (++count > 20000 || depth > 40 || !object(node) || typeof node.type !== 'string' || !nodes.has(node.type)) return false
    if (node.attrs !== undefined && !object(node.attrs)) return false
    if (node.type === 'text' && typeof node.text !== 'string') return false
    if (node.text !== undefined && typeof node.text !== 'string') return false
    if (node.content !== undefined) {
      if (!Array.isArray(node.content)) return false
      for (const child of node.content) pending.push({ node: child, depth: depth + 1 })
    }
    if (node.marks !== undefined) {
      if (!Array.isArray(node.marks) || node.marks.length > 20) return false
      for (const mark of node.marks) {
        if (!object(mark) || typeof mark.type !== 'string' || !marks.has(mark.type) || (mark.attrs !== undefined && !object(mark.attrs))) return false
        if (mark.type === 'link' && (!object(mark.attrs) || !safeReviewerLink(mark.attrs.href))) return false
      }
    }
  }
  return true
}

export function readableReviewerDocument(value: unknown): JSONContent {
  return isReviewerDocument(value) ? value : { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'This reviewer could not be displayed. Its content needs to be repaired.' }] }] }
}
