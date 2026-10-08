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
