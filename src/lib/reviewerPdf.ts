import { MAX_PDF_BYTES, MAX_REVIEWER_SOURCE_CHARACTERS, orderPdfTextItems, type PdfTextItem } from './reviewerPdfText'

export { MAX_PDF_BYTES, MAX_REVIEWER_SOURCE_CHARACTERS, orderPdfTextItems } from './reviewerPdfText'

export class PdfExtractionError extends Error {
  readonly kind: 'size' | 'password' | 'damaged' | 'textless' | 'too-long'
  constructor(kind: 'size' | 'password' | 'damaged' | 'textless' | 'too-long', message: string) { super(message); this.kind = kind }
}

export async function extractPdfText(file: File, onProgress?: (page: number, total: number) => void): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new PdfExtractionError('size', 'Choose a PDF no larger than 20 MB.')
  try {
    const [pdfjs, workerModule] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.min.mjs?url')])
    pdfjs.GlobalWorkerOptions.workerSrc = workerModule.default
    const document = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
    try {
      const pages: string[] = []
      for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
        onProgress?.(pageNumber, document.numPages)
        const page = await document.getPage(pageNumber)
        try {
          const text = await page.getTextContent()
          pages.push(orderPdfTextItems(text.items.filter((item: object) => 'str' in item) as PdfTextItem[]))
        } finally {
          page.cleanup()
        }
      }
      const result = pages.filter(Boolean).join('\n\n').trim()
      if (!result) throw new PdfExtractionError('textless', 'This PDF has no selectable text. Upload a digital PDF, or use Scan notes for photographed pages.')
      if (result.length > MAX_REVIEWER_SOURCE_CHARACTERS) throw new PdfExtractionError('too-long', 'The extracted text is over 100,000 characters. Use a shorter PDF or fewer pages.')
      return result
    } finally {
      await document.destroy().catch(() => undefined)
    }
  } catch (error) {
    if (error instanceof PdfExtractionError) throw error
    if (error instanceof Error && /password/i.test(`${error.name} ${error.message}`)) throw new PdfExtractionError('password', 'Remove the PDF password, then try again.')
    throw new PdfExtractionError('damaged', 'Cali could not read this PDF. Try a valid digital PDF, or use Scan notes for photographed pages.')
  }
}
