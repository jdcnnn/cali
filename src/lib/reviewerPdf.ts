import { MAX_PDF_BYTES, MAX_REVIEWER_SOURCE_CHARACTERS, orderPdfTextItems, type PdfTextItem } from './reviewerPdfText'

export { MAX_PDF_BYTES, MAX_REVIEWER_SOURCE_CHARACTERS, orderPdfTextItems } from './reviewerPdfText'

export class PdfExtractionError extends Error {
  readonly kind: 'size' | 'password' | 'damaged' | 'textless' | 'too-long'
  constructor(kind: 'size' | 'password' | 'damaged' | 'textless' | 'too-long', message: string) { super(message); this.kind = kind }
}

export async function extractPdfText(file: File, onProgress?: (page: number, total: number) => void, signal?: AbortSignal): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new PdfExtractionError('size', 'Choose a PDF no larger than 20 MB.')
  signal?.throwIfAborted()
  try {
    const [pdfjs, workerModule] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
    const loading = pdfjs.getDocument({ data: await file.arrayBuffer() })
    const cancelLoading = () => { void loading.destroy().catch(() => undefined) }
    signal?.addEventListener('abort', cancelLoading, { once: true })
    let document
    try { signal?.throwIfAborted(); document = await loading.promise } finally { signal?.removeEventListener('abort', cancelLoading) }
    const cancelDocument = () => { void document.destroy().catch(() => undefined) }
    signal?.addEventListener('abort', cancelDocument, { once: true })
    try {
      const pages: string[] = []
      const emptyPages: number[] = []
      let sourceLength = 0
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        signal?.throwIfAborted()
        onProgress?.(pageNumber, document.numPages)
        const page = await document.getPage(pageNumber)
        try {
          const text = await page.getTextContent()
          const pageText = orderPdfTextItems(text.items.filter((item: object) => 'str' in item) as PdfTextItem[], pageNumber, document.numPages)
          if (!pageText) emptyPages.push(pageNumber)
          pages.push(pageText)
          sourceLength += pageText.length + 2
          if (sourceLength > MAX_REVIEWER_SOURCE_CHARACTERS) throw new PdfExtractionError('too-long', 'The extracted text is over 100,000 characters. Use a shorter PDF or fewer pages.')
        } finally {
          page.cleanup()
        }
      }
      const result = pages.filter(Boolean).join('\n\n').trim()
      signal?.throwIfAborted()
      if (emptyPages.length === document.numPages) throw new PdfExtractionError('textless', 'This PDF has no selectable text. Upload a digital PDF, or use Scan notes for photographed pages.')
      if (emptyPages.length) throw new PdfExtractionError('textless', 'No selectable text was found on page' + (emptyPages.length === 1 ? ' ' : 's ') + emptyPages.join(', ') + '. Cali cannot safely include these pages. Use a fully text-based PDF or scan the missing notes separately.')
      if (result.length > MAX_REVIEWER_SOURCE_CHARACTERS) throw new PdfExtractionError('too-long', 'The extracted text is over 100,000 characters. Use a shorter PDF or fewer pages.')
      return result
    } finally {
      signal?.removeEventListener('abort', cancelDocument)
      await document.destroy().catch(() => undefined)
    }
  } catch (error) {
    if (signal?.aborted) signal.throwIfAborted()
    if (error instanceof PdfExtractionError) throw error
    if (error instanceof Error && /password/i.test(`${error.name} ${error.message}`)) throw new PdfExtractionError('password', 'Remove the PDF password, then try again.')
    throw new PdfExtractionError('damaged', 'Cali could not read this PDF. Try a valid digital PDF, or use Scan notes for photographed pages.')
  }
}
