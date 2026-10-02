/// <reference lib="webworker" />
import * as pdfjs from 'pdfjs-dist/legacy/build/pdf.mjs'
import * as mammoth from 'mammoth/mammoth.browser'
import type { ExtractRequest, ExtractResult } from './reviewerExtractionProtocol'
import { REVIEWER_MAX_PDF_PAGES } from './reviewers'

declare const self: DedicatedWorkerGlobalScope

self.onmessage = async (event: MessageEvent<ExtractRequest>) => {
  const { id, buffer, sourceType } = event.data
  try {
    if (sourceType === 'docx') {
      const result = await mammoth.extractRawText({ arrayBuffer: buffer })
      self.postMessage({ id, ok: true, text: result.value } satisfies ExtractResult)
      return
    }

    const document = await pdfjs.getDocument({ data: new Uint8Array(buffer) }).promise
    if (document.numPages > REVIEWER_MAX_PDF_PAGES) {
      throw new Error(`PDFs are limited to ${REVIEWER_MAX_PDF_PAGES} pages.`)
    }
    const pages: string[] = []
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      const page = await document.getPage(pageNumber)
      const content = await page.getTextContent()
      const text = content.items.flatMap(item => 'str' in item ? [item.str] : []).join(' ')
      pages.push(text)
      page.cleanup()
    }
    await document.cleanup()
    self.postMessage({ id, ok: true, text: pages.join('\n\n'), pageCount: pages.length } satisfies ExtractResult)
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Cali could not read this file.'
    self.postMessage({ id, ok: false, error: message } satisfies ExtractResult)
  }
}
