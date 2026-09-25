import Tesseract from 'tesseract.js'

export type OcrUpdate = { status: string; percent: number | null }

async function readImageBytes(file: File): Promise<Uint8Array> {
  try {
    return new Uint8Array(await file.arrayBuffer())
  } catch (firstError) {
    const url = URL.createObjectURL(file)
    try {
      const response = await fetch(url)
      if (!response.ok) throw new Error(`Image request returned ${response.status}`)
      return new Uint8Array(await response.arrayBuffer())
    } catch (secondError) {
      console.error('[schedule-image] could not open image', { type: file.type, size: file.size, firstError, secondError })
      throw new Error('This image could not be opened. Retake the photo or upload a JPG or PNG image.')
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

export async function runOCR(
  imageFile: File,
  onProgress?: (update: OcrUpdate) => void
): Promise<string> {
  onProgress?.({ status: 'opening image', percent: null })
  // Read on the page thread: some mobile camera Files fail when Tesseract's worker uses FileReader.
  const bytes = await readImageBytes(imageFile)
  try {
    const result = await Tesseract.recognize(bytes, 'eng', {
      logger: (m) => {
        onProgress?.({
          status: m.status,
          percent: m.status === 'recognizing text' && Number.isFinite(m.progress)
            ? Math.min(100, Math.max(0, Math.round(m.progress * 100))) : null,
        })
      },
    })
    return result.data.text.trim()
  } catch (error) {
    console.error('[schedule-image] text reading failed:', error)
    throw new Error('We could not read the text in this image. Try a clearer photo or upload another image.')
  }
}
