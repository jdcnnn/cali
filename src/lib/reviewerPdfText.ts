export const MAX_PDF_BYTES = 20 * 1024 * 1024
export const MAX_REVIEWER_SOURCE_CHARACTERS = 100_000

export type PdfTextItem = { str: string; transform: number[]; width?: number }

function isPageNumberLine(line: string, pageNumber: number, totalPages: number): boolean {
  const escapedPage = String(pageNumber).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const escapedTotal = String(totalPages).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const marker = line.trim().replace(/[–—]/g, '-')
  return new RegExp(`^(?:-\\s*)?${escapedPage}(?:\\s*-)?$`, 'i').test(marker)
    || new RegExp(`^page\\s+${escapedPage}(?:\\s+(?:of|/)\\s*${escapedTotal})?$`, 'i').test(marker)
    || new RegExp(`^${escapedPage}\\s*(?:of|/)\\s*${escapedTotal}$`, 'i').test(marker)
}

export function orderPdfTextItems(items: PdfTextItem[], pageNumber?: number, totalPages?: number): string {
  const rows: { y: number; items: PdfTextItem[] }[] = []
  for (const item of items.filter(item => item.str.trim())) {
    const y = item.transform[5] ?? 0
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 3)
    if (!row) { row = { y, items: [] }; rows.push(row) }
    row.items.push(item)
  }
  const lines = rows.sort((a, b) => b.y - a.y).map(row => row.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0)).map(item => item.str.trim()).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean)
  if (pageNumber !== undefined && totalPages !== undefined && lines.length) {
    if (isPageNumberLine(lines[0], pageNumber, totalPages)) lines.shift()
    if (lines.length && isPageNumberLine(lines.at(-1)!, pageNumber, totalPages)) lines.pop()
  }
  return lines.join('\n')
}
