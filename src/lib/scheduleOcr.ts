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

async function prepareImage(file: File) {
  if (!ACCEPTED_TYPES.has(file.type)) throw new Error('Choose a JPG, PNG, or WebP image.')
  if (file.size > MAX_FILE_BYTES) throw new Error('Choose an image smaller than 12 MB.')

  let source: CanvasImageSource
  let sourceWidth: number
  let sourceHeight: number
  let bitmap: ImageBitmap | null = null
  let objectUrl = ''

  try {
    try {
      bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })
      source = bitmap
      sourceWidth = bitmap.width
      sourceHeight = bitmap.height
    } catch {
      objectUrl = URL.createObjectURL(file)
      const image = new Image()
      image.decoding = 'async'
      image.src = objectUrl
      await image.decode()
      source = image
      sourceWidth = image.naturalWidth
      sourceHeight = image.naturalHeight
    }

    if (!sourceWidth || !sourceHeight) throw new Error('The selected image has no readable dimensions.')
    if (sourceWidth * sourceHeight > MAX_PIXELS) throw new Error('This image is too large. Use a photo under 20 megapixels.')
    const scale = Math.min(1, MAX_EDGE / Math.max(sourceWidth, sourceHeight))
    const width = Math.max(1, Math.round(sourceWidth * scale))
    const height = Math.max(1, Math.round(sourceHeight * scale))
    const canvas = typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(width, height)
      : document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new Error('This browser could not prepare the image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)

    // This creates the bitmap without decoding or cloning the source again.
    // That avoids a createImageBitmap(canvas) failure seen in Android PWAs.
    if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) return canvas.transferToImageBitmap()
    return await createImageBitmap(canvas)
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export async function runScheduleOcr(file: File, onStatus?: (status: string) => void): Promise<ScheduleOcrResult> {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') throw new Error('Local scanning is not supported on this device. Add the schedule manually instead.')
  onStatus?.('Preparing the image…')
  const image = await prepareImage(file)
  onStatus?.('Getting the scanner ready…')
  const { PaddleOCR } = await import('@paddleocr/paddleocr-js')
  const standalone = matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true)
  let ocr: Awaited<ReturnType<typeof PaddleOCR.create>> | null = null
  try {
    ocr = await PaddleOCR.create({
      // PaddleOCR clones images with createImageBitmap before sending them to
      // its worker. Installed apps use the direct local WASM pipeline so the
      // already-prepared ImageBitmap can be consumed without another clone.
      worker: !standalone,
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textDetectionModelAsset: { url: '/ocr/models/PP-OCRv5_mobile_det_onnx_infer.tar' },
      textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
      textRecognitionModelAsset: { url: '/ocr/models/en_PP-OCRv5_mobile_rec_onnx_infer.tar' },
      textDetectionBatchSize: 1,
      textRecognitionBatchSize: standalone ? 2 : 6,
      ortOptions: {
        backend: 'wasm',
        wasmPaths: '/ocr/runtime/',
        numThreads: 1,
        simd: true,
      },
    })
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
    await ocr?.dispose()
    image.close()
  }
}
