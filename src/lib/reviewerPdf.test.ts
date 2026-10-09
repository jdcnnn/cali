import { beforeEach, describe, expect, it, vi } from 'vitest'

const pdfMocks = vi.hoisted(() => ({
  cleanup: vi.fn(),
  destroy: vi.fn(async () => undefined),
  getDocument: vi.fn(),
  getPage: vi.fn(),
  getTextContent: vi.fn(),
}))

vi.mock('pdfjs-dist', () => ({
  GlobalWorkerOptions: { workerSrc: '' },
  getDocument: pdfMocks.getDocument,
}))

vi.mock('pdfjs-dist/build/pdf.worker.min.mjs?url', () => ({ default: '/assets/pdf.worker.mjs' }))

import { extractPdfText } from './reviewerPdf'

const testFile = { size: 128, arrayBuffer: async () => new ArrayBuffer(8) } as File

describe('reviewer PDF extraction', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    pdfMocks.getTextContent.mockResolvedValue({ items: [{ str: 'Readable notes', transform: [1, 0, 0, 1, 10, 20] }] })
    pdfMocks.getPage.mockResolvedValue({ getTextContent: pdfMocks.getTextContent, cleanup: pdfMocks.cleanup })
    pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 1, getPage: pdfMocks.getPage, destroy: pdfMocks.destroy }) })
  })

  it('releases each page and the PDF document after extracting text', async () => {
    await expect(extractPdfText(testFile)).resolves.toBe('Readable notes')
    expect(pdfMocks.cleanup).toHaveBeenCalledOnce()
    expect(pdfMocks.destroy).toHaveBeenCalledOnce()
  })

  it('releases resources when the PDF has no selectable text', async () => {
    pdfMocks.getTextContent.mockResolvedValue({ items: [] })
    await expect(extractPdfText(testFile)).rejects.toMatchObject({ kind: 'textless' })
    expect(pdfMocks.cleanup).toHaveBeenCalledOnce()
    expect(pdfMocks.destroy).toHaveBeenCalledOnce()
  })
})

it('rejects partially scanned PDFs instead of silently omitting pages', async () => {
  pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage: pdfMocks.getPage, destroy: pdfMocks.destroy }) })
  pdfMocks.getTextContent.mockResolvedValueOnce({ items: [{ str: 'Page one', transform: [1, 0, 0, 1, 10, 20] }] }).mockResolvedValueOnce({ items: [] })
  await expect(extractPdfText(testFile)).rejects.toThrow('page 2')
})
it('does not add page labels to multi-page extracted text', async () => {
  pdfMocks.getDocument.mockReturnValue({ promise: Promise.resolve({ numPages: 2, getPage: pdfMocks.getPage, destroy: pdfMocks.destroy }) })
  pdfMocks.getTextContent.mockResolvedValueOnce({ items: [{ str: 'First topic', transform: [1, 0, 0, 1, 10, 20] }] }).mockResolvedValueOnce({ items: [{ str: 'Second topic', transform: [1, 0, 0, 1, 10, 20] }] })
  await expect(extractPdfText(testFile)).resolves.toBe('First topic\n\nSecond topic')
})
it('stops a cancelled PDF before initializing the PDF worker', async () => {
  const controller = new AbortController(); controller.abort()
  await expect(extractPdfText(testFile, undefined, controller.signal)).rejects.toMatchObject({ name: 'AbortError' })
})
