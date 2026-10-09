import { describe, expect, it } from 'vitest'
import { MAX_PDF_BYTES, MAX_REVIEWER_SOURCE_CHARACTERS, orderPdfTextItems } from './reviewerPdfText'

describe('PDF text extraction helpers', () => {
  it('orders lines top-to-bottom and words left-to-right', () => {
    expect(orderPdfTextItems([
      { str: 'world', transform: [1, 0, 0, 1, 60, 90] },
      { str: 'Second line', transform: [1, 0, 0, 1, 10, 50] },
      { str: 'Hello', transform: [1, 0, 0, 1, 10, 91] },
    ])).toBe('Hello world\nSecond line')
  })

  it('drops empty items and exposes the documented limits', () => {
    expect(orderPdfTextItems([{ str: '  ', transform: [1, 0, 0, 1, 0, 0] }])).toBe('')
    expect(MAX_PDF_BYTES).toBe(20 * 1024 * 1024)
    expect(MAX_REVIEWER_SOURCE_CHARACTERS).toBe(100_000)
  })

  it('removes standalone page markers only from page edges', () => {
    const items = [
      { str: 'Biology notes', transform: [1, 0, 0, 1, 10, 90] },
      { str: '1', transform: [1, 0, 0, 1, 10, 50] },
      { str: 'Page 2 of 4', transform: [1, 0, 0, 1, 10, 10] },
    ]
    expect(orderPdfTextItems(items, 2, 4)).toBe('Biology notes\n1')
    expect(orderPdfTextItems([{ str: '3', transform: [1, 0, 0, 1, 10, 10] }], 3, 4)).toBe('')
  })
})
