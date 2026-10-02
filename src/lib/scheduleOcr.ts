import type { OcrLine } from './rtuScheduleParser'
import type { ScheduleOcrWorkerRequest, ScheduleOcrWorkerResponse } from './scheduleOcrProtocol'

const MAX_FILE_BYTES = 12 * 1024 * 1024
const MAX_PIXELS = 20_000_000
const MAX_EDGE = 2048
const IDLE_RELEASE_MS = 5 * 60 * 1000
const ACCEPTED_TYPES = new Set(['image/jpeg', 'image/png', 'image/webp'])

export type ScheduleOcrResult = {
  lines: OcrLine[]
  image: { width: number; height: number }
  setupMs: number
  prepareMs: number
  predictMs: number
  totalMs: number
}

type PendingRequest = {
  resolve: (response: ScheduleOcrWorkerResponse) => void
  reject: (error: Error) => void
}

type WorkerState = {
  worker: Worker
  pending: Map<number, PendingRequest>
  initialization: Promise<number> | null
  idleTimer: ReturnType<typeof setTimeout> | null
}

let state: WorkerState | null = null
let nextRequestId = 1

function abortError() {
  return new DOMException('The scan was stopped.', 'AbortError')
}

function throwIfAborted(signal?: AbortSignal) {
  if (signal?.aborted) throw abortError()
}

function deserializeError(serialized: { name: string; message: string; stack?: string }) {
  const error = new Error(serialized.message)
  error.name = serialized.name
  if (serialized.stack) error.stack = serialized.stack
  return error
}

function destroyWorker(target: WorkerState, reason: Error) {
  if (state === target) state = null
  if (target.idleTimer) clearTimeout(target.idleTimer)
  target.worker.terminate()
  for (const request of target.pending.values()) request.reject(reason)
  target.pending.clear()
}

function scheduleIdleRelease(target: WorkerState) {
  if (target.idleTimer) clearTimeout(target.idleTimer)
  target.idleTimer = setTimeout(() => {
    if (state === target) releaseScheduleOcr()
  }, IDLE_RELEASE_MS)
}

function getWorkerState() {
  if (state) return state
  const worker = new Worker(new URL('./scheduleOcr.worker.ts', import.meta.url), { type: 'module', name: 'cali-schedule-ocr' })
  const created: WorkerState = { worker, pending: new Map(), initialization: null, idleTimer: null }
  worker.onmessage = (event: MessageEvent<ScheduleOcrWorkerResponse>) => {
    const message = event.data
    const request = created.pending.get(message.requestId)
    if (!request) return
    created.pending.delete(message.requestId)
    if (message.type === 'failed') request.reject(deserializeError(message.error))
    else request.resolve(message)
  }
  worker.onerror = event => destroyWorker(created, new Error(event.message || 'The scanner worker stopped unexpectedly.'))
  worker.onmessageerror = () => destroyWorker(created, new Error('The scanner worker returned an unreadable result.'))
  state = created
  return created
}

function requestWorker(target: WorkerState, message: ScheduleOcrWorkerRequest, transfer: Transferable[] = []) {
  return new Promise<ScheduleOcrWorkerResponse>((resolve, reject) => {
    target.pending.set(message.requestId, { resolve, reject })
    try {
      target.worker.postMessage(message, transfer)
    } catch (error) {
      target.pending.delete(message.requestId)
      reject(error instanceof Error ? error : new Error(String(error)))
    }
  })
}

function isStandalone() {
  return matchMedia('(display-mode: standalone)').matches
    || ('standalone' in navigator && navigator.standalone === true)
}

function ensureInitialized() {
  const target = getWorkerState()
  if (target.initialization) return target.initialization
  const requestId = nextRequestId++
  target.initialization = requestWorker(target, { type: 'initialize', requestId, standalone: isStandalone() })
    .then(response => {
      if (response.type !== 'initialized') throw new Error('The scanner returned an unexpected setup response.')
      scheduleIdleRelease(target)
      return response.setupMs
    })
    .catch(error => {
      destroyWorker(target, error instanceof Error ? error : new Error(String(error)))
      throw error
    })
  return target.initialization
}

export async function preloadScheduleOcr() {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') {
    throw new Error('Local scanning is not supported on this device. Add the schedule manually instead.')
  }
  return ensureInitialized()
}

export function releaseScheduleOcr() {
  const target = state
  if (!target) return
  const requestId = nextRequestId++
  void requestWorker(target, { type: 'dispose', requestId }).catch(() => undefined)
  destroyWorker(target, new Error('The scanner was released after being idle.'))
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
    const canvas = typeof OffscreenCanvas !== 'undefined' ? new OffscreenCanvas(width, height) : document.createElement('canvas')
    canvas.width = width
    canvas.height = height
    const context = canvas.getContext('2d', { alpha: false }) as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null
    if (!context) throw new Error('This browser could not prepare the image.')
    context.fillStyle = '#fff'
    context.fillRect(0, 0, width, height)
    context.imageSmoothingEnabled = true
    context.imageSmoothingQuality = 'high'
    context.drawImage(source, 0, 0, width, height)
    // Avoid decoding or cloning the source again; this also works around a
    // createImageBitmap(canvas) failure seen in some Android PWAs.
    if (typeof OffscreenCanvas !== 'undefined' && canvas instanceof OffscreenCanvas) return canvas.transferToImageBitmap()
    return await createImageBitmap(canvas)
  } finally {
    bitmap?.close()
    if (objectUrl) URL.revokeObjectURL(objectUrl)
  }
}

export async function runScheduleOcr(file: File, onStatus?: (status: string) => void, signal?: AbortSignal): Promise<ScheduleOcrResult> {
  if (typeof WebAssembly === 'undefined' || typeof Worker === 'undefined') throw new Error('Local scanning is not supported on this device. Add the schedule manually instead.')
  throwIfAborted(signal)
  const totalStartedAt = performance.now()
  onStatus?.('Preparing the image while the scanner gets ready…')
  const setupPromise = ensureInitialized()
  void setupPromise.catch(() => undefined)
  const activeState = state
  if (activeState?.idleTimer) clearTimeout(activeState.idleTimer)
  const stopActiveWork = () => {
    if (activeState && state === activeState) destroyWorker(activeState, abortError())
  }
  signal?.addEventListener('abort', stopActiveWork, { once: true })
  const prepareStartedAt = performance.now()
  let image: ImageBitmap | null = null
  try {
    image = await prepareImage(file)
    const prepareMs = performance.now() - prepareStartedAt
    throwIfAborted(signal)
    onStatus?.('Finishing scanner setup…')
    const setupMs = await setupPromise
    throwIfAborted(signal)
    onStatus?.('Reading your class schedule…')
    const target = state
    if (!target) throw new Error('The scanner stopped before prediction began.')
    if (target.idleTimer) clearTimeout(target.idleTimer)
    const requestId = nextRequestId++
    const request = requestWorker(target, { type: 'predict', requestId, image }, [image])
    image = null
    let response: ScheduleOcrWorkerResponse
    try {
      response = await request
    } catch (error) {
      if (state === target) destroyWorker(target, error instanceof Error ? error : new Error(String(error)))
      throw error
    }
    if (response.type !== 'predicted') throw new Error('The scanner returned an unexpected prediction response.')
    scheduleIdleRelease(target)
    return { lines: response.lines, image: response.image, setupMs, prepareMs, predictMs: response.predictMs, totalMs: performance.now() - totalStartedAt }
  } finally {
    signal?.removeEventListener('abort', stopActiveWork)
    image?.close()
  }
}
