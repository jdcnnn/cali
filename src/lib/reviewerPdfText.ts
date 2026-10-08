export const MAX_PDF_BYTES = 20 * 1024 * 1024
export const MAX_REVIEWER_SOURCE_CHARACTERS = 100_000

export type PdfTextItem = { str: string; transform: number[]; width?: number }

export function orderPdfTextItems(items: PdfTextItem[]): string {
  const rows: { y: number; items: PdfTextItem[] }[] = []
  for (const item of items.filter(item => item.str.trim())) {
    const y = item.transform[5] ?? 0
    let row = rows.find(candidate => Math.abs(candidate.y - y) <= 3)
    if (!row) { row = { y, items: [] }; rows.push(row) }
    row.items.push(item)
  }
  return rows.sort((a, b) => b.y - a.y).map(row => row.items.sort((a, b) => (a.transform[4] ?? 0) - (b.transform[4] ?? 0)).map(item => item.str.trim()).join(' ').replace(/\s+/g, ' ').trim()).filter(Boolean).join('\n')
}
