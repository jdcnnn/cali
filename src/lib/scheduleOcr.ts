import type { OcrLine } from './rtuScheduleParser'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_PIXELS = 20_000_000
const MAX_EDGE = 2048
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type ScheduleOcrResult = {
  lines: OcrLine[]
  image: { width: number; height: number }
  elapsedMs: number
}

async function decodeImage(file: File) {
  try {
    return await createImageBitmap(file, { imageOrientation: 'from-image' })
  } catch {
    const url = URL.createObjectURL(file)
    try {
      const image = new Image()
      image.src = url
      await image.decode()
      return await createImageBitmap(image)
    } finally {
      URL.revokeObjectURL(url)
    }
  }
}

async function prepareImage(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose an image smaller than 12 MB.')
  const bitmap = await decodeImage(file)
  try {
    if (bitmap.width * bitmap.height > MAX_PIXELS) throw new Error('This image is too large. Use a photo under 20 megapixels.')
    const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height))
    const width = Math.max(1, Math.round(bitmap.width * scale))
    const height = Math.max(1, Math.round(bitmap.height * scale))
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false })
    if (!context) throw new Error('This browser could not prepare the image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(bitmap, 0, 0, width, height)
    const blob = await new Promise<Blob | null>(resolve => canvas.toBlob(resolve, 'image/jpeg', 0.94))
    if (!blob) throw new Error('This browser could not prepare the image.')
    return blob
  } finally {
    bitmap.close()
  }
}

export async function runScheduleOcr(file: File, onStatus?: (status: string) => void): Promise<ScheduleOcrResult> {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') throw new Error('Local scanning is not supported on this device. Add the schedule manually instead.')
  onStatus?.('Preparing the image…')
  const image = await prepareImage(file)
  onStatus?.('Getting the scanner ready…')
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
  const ocr = await PaddleOCR.create({
    worker: true,
    textDetectionModelName: 'PP-OCRv5_mobile_det',
    textDetectionModelAsset: { url: '/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar' },
    textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
    textRecognitionModelAsset: { url: '/ocr/models/en_PP-OCRv5_mobile_rec_onnx_infer.tar' },
    textDetectionBatchSize: 1,
    textRecognitionBatchSize: 6,
    ortOptions: {
      backend: 'wasm',
      wasmPaths: '/ocr/runtime/',
      numThreads: 1,
      simd: true,
    },
  })
  try {
    onStatus?.('Reading your class schedule…')
    const [result] = await ocr.predict(image, {
      textDetLimitSideLen: MAX_EDGE,
      textDetLimitType: 'max',
      textDetMaxSideLimit: MAX_EDGE,
      textRecScoreThresh: 0.3,
    })
    if (!result) throw new Error('The scanner could not read this image. Try a clearer photo.')
    return {
      lines: result.items.map(item => ({ poly: item.poly.map(([x, y]) => ({ x, y })), text: item.text, score: item.score })),
      image: result.image,
      elapsedMs: result.metrics.totalMs,
    }
  } finally {
    await ocr.dispose()
  }
}
