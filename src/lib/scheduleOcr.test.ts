import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { ScheduleOcrWorkerRequest, ScheduleOcrWorkerResponse } from './scheduleOcrProtocol'

class FakeBitmap {
  width = 1200
  height = 800
  close = vi.fn()
}

class FakeCanvas {
  width: number
  height: number

  constructor(width: number, height: number) {
    this.width = width
    this.height = height
  }

  getContext() {
    return {
      fillStyle: '',
      imageSmoothingEnabled: false,
      imageSmoothingQuality: 'low',
      fillRect: vi.fn(),
      drawImage: vi.fn(),
    }
  }

  transferToImageBitmap() {
    const bitmap = new FakeBitmap()
    bitmap.width = this.width
    bitmap.height = this.height
    return bitmap
  }
}

class FakeWorker {
  static instances: FakeWorker[] = []
  messages: ScheduleOcrWorkerRequest[] = []
  terminated = false
  onmessage: ((event: MessageEvent<ScheduleOcrWorkerResponse>) => void) | null = null
  onerror: ((event: ErrorEvent) => void) | null = null
  onmessageerror: (() => void) | null = null

  constructor() {
    FakeWorker.instances.push(this)
  }

  postMessage(message: ScheduleOcrWorkerRequest) {
    this.messages.push(message)
  }

  terminate() {
    this.terminated = true
  }

  respond(response: ScheduleOcrWorkerResponse) {
    this.onmessage?.({ data: response } as MessageEvent<ScheduleOcrWorkerResponse>)
  }
}

const imageFile = { type: 'image/png', size: 1024 } as File

describe('schedule OCR controller', () => {
  beforeAll(() => {
    vi.stubGlobal('Worker', FakeWorker)
    vi.stubGlobal('ImageBitmap', FakeBitmap)
    vi.stubGlobal('OffscreenCanvas', FakeCanvas)
    vi.stubGlobal('createImageBitmap', vi.fn(async () => new FakeBitmap()))
    vi.stubGlobal('matchMedia', vi.fn(() => ({ matches: false })))
    vi.stubGlobal('navigator', { standalone: false })
  })

  beforeEach(async () => {
    const { releaseScheduleOcr } = await import('./scheduleOcr')
    releaseScheduleOcr()
    FakeWorker.instances = []
  })

  afterAll(() => {
    vi.unstubAllGlobals()
  })

  it('deduplicates preload and reuses the initialized worker for prediction', async () => {
    const { preloadScheduleOcr, runScheduleOcr, releaseScheduleOcr } = await import('./scheduleOcr')
    const first = preloadScheduleOcr()
    const second = preloadScheduleOcr()
    const worker = FakeWorker.instances[0]

    expect(FakeWorker.instances).toHaveLength(1)
    expect(worker.messages).toHaveLength(1)
    const initialize = worker.messages[0]
    worker.respond({ type: 'initialized', requestId: initialize.requestId, setupMs: 42 })
    await expect(Promise.all([first, second])).resolves.toEqual([42, 42])

    const scan = runScheduleOcr(imageFile)
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2))
    const prediction = worker.messages[1]
    worker.respond({ type: 'predicted', requestId: prediction.requestId, lines: [], image: { width: 1200, height: 800 }, predictMs: 75 })
    const result = await scan

    expect(result.setupMs).toBe(42)
    expect(result.predictMs).toBe(75)
    expect(FakeWorker.instances).toHaveLength(1)
    releaseScheduleOcr()
  })

  it('prepares the image while initialization is still running', async () => {
    const { runScheduleOcr, releaseScheduleOcr } = await import('./scheduleOcr')
    let finishDecode: ((bitmap: FakeBitmap) => void) | undefined
    vi.mocked(createImageBitmap).mockImplementationOnce(() => new Promise(resolve => { finishDecode = resolve }) as Promise<ImageBitmap>)

    const scan = runScheduleOcr(imageFile)
    const worker = FakeWorker.instances[0]
    expect(worker.messages[0].type).toBe('initialize')
    worker.respond({ type: 'initialized', requestId: worker.messages[0].requestId, setupMs: 30 })
    expect(worker.messages).toHaveLength(1)

    finishDecode?.(new FakeBitmap())
    await vi.waitFor(() => expect(worker.messages).toHaveLength(2))
    worker.respond({ type: 'predicted', requestId: worker.messages[1].requestId, lines: [], image: { width: 1200, height: 800 }, predictMs: 50 })
    await expect(scan).resolves.toMatchObject({ setupMs: 30, predictMs: 50 })
    releaseScheduleOcr()
  })

  it('clears a failed initialization so the next preload can retry', async () => {
    const { preloadScheduleOcr, releaseScheduleOcr } = await import('./scheduleOcr')
    const failed = preloadScheduleOcr()
    const firstWorker = FakeWorker.instances[0]
    const initialize = firstWorker.messages[0]
    firstWorker.respond({ type: 'failed', requestId: initialize.requestId, error: { name: 'Error', message: 'setup failed' } })
    await expect(failed).rejects.toThrow('setup failed')
    expect(firstWorker.terminated).toBe(true)

    const retried = preloadScheduleOcr()
    const secondWorker = FakeWorker.instances[1]
    const retryInitialize = secondWorker.messages[0]
    secondWorker.respond({ type: 'initialized', requestId: retryInitialize.requestId, setupMs: 18 })
    await expect(retried).resolves.toBe(18)
    releaseScheduleOcr()
  })

  it('terminates initialization on cancellation and recreates a healthy worker', async () => {
    const { preloadScheduleOcr, runScheduleOcr, releaseScheduleOcr } = await import('./scheduleOcr')
    const controller = new AbortController()
    const scan = runScheduleOcr(imageFile, undefined, controller.signal)
    const firstWorker = FakeWorker.instances[0]
    controller.abort()

    await expect(scan).rejects.toMatchObject({ name: 'AbortError' })
    expect(firstWorker.terminated).toBe(true)

    const next = preloadScheduleOcr()
    const secondWorker = FakeWorker.instances[1]
    const initialize = secondWorker.messages[0]
    secondWorker.respond({ type: 'initialized', requestId: initialize.requestId, setupMs: 20 })
    await expect(next).resolves.toBe(20)
    releaseScheduleOcr()
  })
})
