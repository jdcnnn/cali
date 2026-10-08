import { describe, expect, it } from 'vitest'
import { combineNotePageText, MAX_NOTE_PAGES, orderNoteLines } from './noteScanner'

describe('notebook note ordering', () => {
  it('orders OCR lines top-to-bottom and fragments left-to-right', () => {
    const box = (x: number, y: number, text: string) => ({ text, score: .9, poly: [{ x, y }, { x: x + 30, y }, { x: x + 30, y: y + 12 }, { x, y: y + 12 }] })
    expect(orderNoteLines([box(80, 10, 'biology'), box(10, 60, 'Second line'), box(10, 11, 'Cell')])).toBe('Cell biology\nSecond line')
  })

  it('drops blank recognition and limits a batch to ten pages', () => {
    expect(orderNoteLines([{ text: ' ', score: .2, poly: [{ x: 0, y: 0 }] }])).toBe('')
    expect(MAX_NOTE_PAGES).toBe(10)
  })

  it('preserves multi-page order with explicit page boundaries', () => {
    expect(combineNotePageText(['First page', 'Second page'])).toBe('Page 1\nFirst page\n\nPage 2\nSecond page')
    expect(combineNotePageText(['Only page'])).toBe('Only page')
  })
})
