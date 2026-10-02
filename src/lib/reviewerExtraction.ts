import type { ExtractRequest, ExtractResult } from './reviewerExtractionProtocol'
import {
  normalizeExtractedText,
  REVIEWER_EXTRACTION_TIMEOUT_MS,
  REVIEWER_MAX_FILE_BYTES,
  type ReviewerSourceType,
} from './reviewers'

export async function extractReviewerFile(file: File): Promise<{ text: string; sourceType: Exclude<ReviewerSourceType, 'text'> }> {
  if (file.size > REVIEWER_MAX_FILE_BYTES) throw new Error('Files are limited to 10 MB.')
  const extension = file.name.toLocaleLowerCase().split('.').pop()
  const sourceType = extension === 'pdf' ? 'pdf' : extension === 'docx' ? 'docx' : null
  if (!sourceType) throw new Error('Upload a PDF or DOCX file.')

  const worker = new Worker(new URL('./reviewerExtraction.worker.ts', import.meta.url), { type: 'module' })
  const id = crypto.randomUUID()
  try {
    const buffer = await file.arrayBuffer()
    return await new Promise((resolve, reject) => {
      const timeout = window.setTimeout(() => {
        worker.terminate()
        reject(new Error('File reading took too long. Try a simpler file or paste the text.'))
      }, REVIEWER_EXTRACTION_TIMEOUT_MS)
      worker.onmessage = (event: MessageEvent<ExtractResult>) => {
        if (event.data.id !== id) return
        window.clearTimeout(timeout)
        if (!event.data.ok) reject(new Error(event.data.error))
        else resolve({ text: normalizeExtractedText(event.data.text), sourceType })
      }
      worker.onerror = () => {
        window.clearTimeout(timeout)
        reject(new Error('Cali could not read this file. Try pasting its text instead.'))
      }
      worker.postMessage({ id, buffer, sourceType } satisfies ExtractRequest, [buffer])
    })
  } finally {
    worker.terminate()
  }
}
