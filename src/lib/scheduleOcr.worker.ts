import { PaddleOCR } from '@paddleocr/paddleocr-js'
import type { OcrResult, PaddleOCRCreateOptions } from '@paddleocr/paddleocr-js'
import type { Mat } from '@techstark/opencv-js'
import type { ScheduleOcrWorkerRequest, ScheduleOcrWorkerResponse } from './scheduleOcrProtocol'

const OCR_ASSET_ROOT = '/ocr/v1'

type OcrInstance = {
  initialize(): Promise<{ elapsedMs: number }>
  predict(input: unknown, params?: Record<string, unknown>): Promise<OcrResult[]>
  dispose(): Promise<void>
  sourceToMat: (cv: CvAdapter, source: unknown) => Promise<{ width: number; height: number; mat: Mat; dispose(): void }>
}

type CvAdapter = { CV_8UC4: number; matFromArray(rows: number, cols: number, type: number, data: ArrayBufferView): Mat }

type WorkerScope = {
  postMessage(message: ScheduleOcrWorkerResponse): void
  onmessage: ((event: MessageEvent<ScheduleOcrWorkerRequest>) => void) | null
}

const workerScope = self as unknown as WorkerScope
let ocr: OcrInstance | null = null
let initialization: Promise<number> | null = null
let workQueue = Promise.resolve()

async function workerSourceToMat(cv: CvAdapter, source: unknown) {
  if (!(source instanceof ImageBitmap)) throw new Error('The OCR worker expected an ImageBitmap.')
  if (typeof OffscreenCanvas !== 'function') throw new Error('Local scanning requires OffscreenCanvas support.')
  const canvas = new OffscreenCanvas(source.width, source.height)
  const context = canvas.getContext('2d', { willReadFrequently: true })
  if (!context) throw new Error('The OCR worker could not create an image canvas.')
  context.drawImage(source, 0, 0)
  const imageData = context.getImageData(0, 0, source.width, source.height)
  const mat = cv.matFromArray(imageData.height, imageData.width, cv.CV_8UC4, imageData.data)
  return { width: source.width, height: source.height, mat, dispose: () => mat.delete() }
}

function serializeError(value: unknown) {
  const error = value instanceof Error ? value : new Error(String(value))
  return { name: error.name, message: error.message, stack: error.stack }
}

function initialize(standalone: boolean) {
  if (initialization) return initialization
  initialization = (async () => {
    const options: PaddleOCRCreateOptions = {
      worker: false,
      initialize: false,
      textDetectionModelName: 'PP-OCRv5_mobile_det',
      textDetectionModelAsset: { url: `${OCR_ASSET_ROOT}/models/PP-OCRv5_mobile_det_onnx_infer.tar` },
      textRecognitionModelName: 'en_PP-OCRv5_mobile_rec',
      textRecognitionModelAsset: { url: `${OCR_ASSET_ROOT}/models/en_PP-OCRv5_mobile_rec_onnx_infer.tar` },
      textDetectionBatchSize: 1,
      textRecognitionBatchSize: standalone ? 2 : 6,
      ortOptions: { backend: 'wasm', wasmPaths: `${OCR_ASSET_ROOT}/runtime/`, numThreads: 1, simd: true },
    }
    ocr = await PaddleOCR.create(options) as unknown as OcrInstance
    ocr.sourceToMat = workerSourceToMat
    const summary = await ocr.initialize()
    return summary.elapsedMs
  })()
  initialization.catch(() => {
    initialization = null
    ocr = null
  })
  return initialization
}

async function handle(message: ScheduleOcrWorkerRequest) {
  try {
    if (message.type === 'initialize') {
      const setupMs = await initialize(message.standalone)
      workerScope.postMessage({ type: 'initialized', requestId: message.requestId, setupMs })
      return
    }
    if (message.type === 'dispose') {
      await ocr?.dispose()
      ocr = null
      initialization = null
      workerScope.postMessage({ type: 'disposed', requestId: message.requestId })
      return
    }
    await initialization
    if (!ocr) throw new Error('The scanner was not initialized.')
    const startedAt = performance.now()
    const [result] = await ocr.predict(message.image, {
      textDetLimitSideLen: 2048,
      textDetLimitType: 'max',
      textDetMaxSideLimit: 2048,
      textRecScoreThresh: 0.3,
    })
    if (!result) throw new Error('The scanner could not read this image. Try a clearer photo.')
    workerScope.postMessage({
      type: 'predicted',
      requestId: message.requestId,
      lines: result.items.map(item => ({ poly: item.poly.map(([x, y]) => ({ x, y })), text: item.text, score: item.score })),
      image: result.image,
      predictMs: performance.now() - startedAt,
    })
  } catch (error) {
    workerScope.postMessage({ type: 'failed', requestId: message.requestId, error: serializeError(error) })
  } finally {
    if (message.type === 'predict') message.image.close()
  }
}

workerScope.onmessage = event => {
  const message = event.data
  workQueue = workQueue.then(() => handle(message), () => handle(message))
}
