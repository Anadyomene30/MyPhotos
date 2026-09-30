/**
 * ML worker thread: owns the ONNX sessions so inference never blocks the backend event loop.
 * Messages: { id, type: 'init' | 'faces' | 'clip-image' | 'clip-text', ... } → { id, ok, result | error }.
 */
import { parentPort } from 'node:worker_threads'
import { RawImage } from '@huggingface/transformers'
import { ARCFACE_DST, FaceEngine, similarityTransform, warpCrop, type FaceResult } from './faces'
import { ClipEngine } from './clip'
import { join } from 'node:path'

export type WorkerMessage =
  | { id: number; type: 'init'; modelsDir: string; faces: boolean; clip: boolean }
  | { id: number; type: 'faces'; rgb: Uint8Array; w: number; h: number }
  | { id: number; type: 'clip-image'; rgb: Uint8Array; w: number; h: number }
  | { id: number; type: 'clip-text'; texts: string[] }
  | { id: number; type: 'dispose' }

export interface FaceOut {
  x: number
  y: number
  w: number
  h: number
  score: number
  quality: number
  kps: number[]
  emb: Float32Array
}

let faceEngine: FaceEngine | null = null
let clipEngine: ClipEngine | null = null

async function facesOf(rgb: Uint8Array, w: number, h: number): Promise<FaceOut[]> {
  const detected = (await faceEngine!.detect(rgb, w, h)).slice(0, 40)
  const out: FaceOut[] = []
  const minSide = Math.min(w, h)
  for (const f of detected) {
    const crop = warpCrop(rgb, w, h, similarityTransform(f.kps, ARCFACE_DST), 112)
    const emb = await faceEngine!.embed(crop)
    const size = Math.max(f.x2 - f.x1, f.y2 - f.y1) / minSide
    const r: FaceResult = { ...f, embedding: emb, quality: Math.min(1, f.score) * Math.min(1, size / 0.1) }
    out.push({ x: r.x1 / w, y: r.y1 / h, w: (r.x2 - r.x1) / w, h: (r.y2 - r.y1) / h, score: r.score, quality: r.quality, kps: r.kps.flatMap(([x, y]) => [x / w, y / h]), emb })
  }
  return out
}

async function handle(m: WorkerMessage): Promise<unknown> {
  switch (m.type) {
    case 'init': {
      if (m.faces) {
        faceEngine = new FaceEngine(join(m.modelsDir, 'faces', 'det_10g.onnx'), join(m.modelsDir, 'faces', 'w600k_r50.onnx'))
        await faceEngine.load()
      }
      if (m.clip) {
        clipEngine = new ClipEngine(m.modelsDir)
        await clipEngine.load()
      }
      return { faces: Boolean(faceEngine), clip: Boolean(clipEngine) }
    }
    case 'faces':
      if (!faceEngine) throw new Error('face models not loaded')
      return facesOf(m.rgb, m.w, m.h)
    case 'clip-image': {
      if (!clipEngine) throw new Error('clip model not loaded')
      const img = new RawImage(m.rgb, m.w, m.h, 3)
      return clipEngine.embedRaw(img)
    }
    case 'clip-text':
      if (!clipEngine) throw new Error('clip model not loaded')
      return clipEngine.embedTexts(m.texts)
    case 'dispose':
      await faceEngine?.dispose()
      await clipEngine?.dispose()
      faceEngine = clipEngine = null
      return true
  }
}

parentPort?.on('message', (m: WorkerMessage) => {
  handle(m).then(
    (result) => parentPort?.postMessage({ id: m.id, ok: true, result }),
    (e: Error) => parentPort?.postMessage({ id: m.id, ok: false, error: e.message })
  )
})
