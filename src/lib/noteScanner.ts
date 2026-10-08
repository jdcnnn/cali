import type { OcrLine } from './rtuScheduleParser'
import { MAX_REVIEWER_SOURCE_CHARACTERS } from './reviewerPdfText'

export const MAX_NOTE_PAGES = 10

function linePosition(line: OcrLine) {
  const xs = line.poly.map(point => point.x)
  const ys = line.poly.map(point => point.y)
  return { x: Math.min(...xs), y: Math.min(...ys), height: Math.max(...ys) - Math.min(...ys) }
}

export function orderNoteLines(lines: OcrLine[]): string {
  const positioned = lines.filter(line => line.text.trim()).map(line => ({ line, ...linePosition(line) }))
  const rows: { y: number; height: number; lines: typeof positioned }[] = []
  for (const item of positioned.sort((a, b) => a.y - b.y || a.x - b.x)) {
    const row = rows.find(candidate => Math.abs(candidate.y - item.y) <= Math.max(6, Math.min(candidate.height, item.height) * 0.55))
    if (row) row.lines.push(item)
    else rows.push({ y: item.y, height: Math.max(1, item.height), lines: [item] })
  }
  return rows.sort((a, b) => a.y - b.y).map(row => row.lines.sort((a, b) => a.x - b.x).map(item => item.line.text.trim()).join(' ').replace(/\s+/g, ' ')).join('\n').trim()
}

export function combineNotePageText(pages: string[]): string {
  return pages.map((text, index) => pages.length > 1 ? `Page ${index + 1}\n${text.trim()}` : text.trim()).join('\n\n').trim()
}

export async function scanNotePages(files: File[], onStatus?: (status: string) => void): Promise<string> {
  if (!files.length) throw new Error('Add at least one notebook page to scan.')
  if (files.length > MAX_NOTE_PAGES) throw new Error(`Scan no more than ${MAX_NOTE_PAGES} pages at a time.`)
  // Reuse Cali's single initialized OCR worker so multi-page notes do not load
  // another model copy alongside the schedule scanner.
  const { runScheduleOcr: runLocalOcr } = await import('./scheduleOcr')
  const pages: string[] = []
  for (let index = 0; index < files.length; index += 1) {
    onStatus?.(`Scanning page ${index + 1} of ${files.length} on this device…`)
    let result
    try { result = await runLocalOcr(files[index]) }
    catch (error) {
      const message = error instanceof Error ? error.message : ''
      if (/not supported|WebAssembly|Worker|OffscreenCanvas/i.test(message)) throw new Error('On-device note scanning is not supported in this browser. Try another modern browser or upload a digital PDF.')
      throw error
    }
    const text = orderNoteLines(result.lines)
    if (!text) throw new Error(`Page ${index + 1} has no readable text. Try a clearer, straighter photo with even lighting.`)
    pages.push(text)
  }
  const combined = combineNotePageText(pages)
  if (combined.length > MAX_REVIEWER_SOURCE_CHARACTERS) throw new Error('The scanned notes exceed 100,000 characters. Generate from fewer pages at a time.')
  return combined
}
