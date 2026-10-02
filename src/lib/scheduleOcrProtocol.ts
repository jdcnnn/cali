import type { OcrLine } from './rtuScheduleParser'

export type ScheduleOcrWorkerRequest =
  | { type: 'initialize'; requestId: number; standalone: boolean }
  | { type: 'predict'; requestId: number; image: ImageBitmap }
  | { type: 'dispose'; requestId: number }

export type ScheduleOcrWorkerResponse =
  | { type: 'initialized'; requestId: number; setupMs: number }
  | { type: 'predicted'; requestId: number; lines: OcrLine[]; image: { width: number; height: number }; predictMs: number }
  | { type: 'disposed'; requestId: number }
  | { type: 'failed'; requestId: number; error: { name: string; message: string; stack?: string } }

