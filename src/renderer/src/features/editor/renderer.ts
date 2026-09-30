import { planGeometry } from '@shared/edit/pipeline'
import type { PhotoEdit } from '@shared/edit/types'
import type { WorkerRequest } from './worker'

/** Canvas-based geometry (GPU) matching the backend's sharp pipeline. */
export function drawGeometry(src: HTMLCanvasElement | HTMLImageElement, sw: number, sh: number, g: PhotoEdit['geometry'], withCrop: boolean): HTMLCanvasElement {
  const plan = planGeometry(sw, sh, withCrop ? g : { ...g, crop: null })
  const box = document.createElement('canvas')
  box.width = plan.bw
  box.height = plan.bh
  const bctx = box.getContext('2d')!
  bctx.fillStyle = '#000'
  bctx.fillRect(0, 0, plan.bw, plan.bh)
  bctx.translate(plan.bw / 2, plan.bh / 2)
  bctx.rotate((plan.angle * Math.PI) / 180)
  if (plan.flipH) bctx.scale(-1, 1)
  bctx.imageSmoothingQuality = 'high'
  bctx.drawImage(src, -sw / 2, -sh / 2, sw, sh)
  const out = document.createElement('canvas')
  out.width = plan.width
  out.height = plan.height
  out.getContext('2d')!.drawImage(box, plan.left, plan.top, plan.width, plan.height, 0, 0, plan.width, plan.height)
  return out
}

/** Runs the tone pipeline in a worker, always processing the latest request only. */
export class PreviewRenderer {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' })
  private seq = 0
  private busy = false
  private pending: { canvas: HTMLCanvasElement; edit: PhotoEdit; onDone(img: ImageData): void } | null = null

  constructor() {
    this.worker.onmessage = (ev: MessageEvent<{ id: number; buf: Uint8ClampedArray; w: number; h: number }>) => {
      const { buf, w, h } = ev.data
      const cb = this.callbacks.get(ev.data.id)
      this.callbacks.delete(ev.data.id)
      cb?.(new ImageData(buf as Uint8ClampedArray<ArrayBuffer>, w, h))
      this.busy = false
      this.flush()
    }
  }

  private callbacks = new Map<number, (img: ImageData) => void>()

  render(canvas: HTMLCanvasElement, edit: PhotoEdit, onDone: (img: ImageData) => void): void {
    this.pending = { canvas, edit, onDone }
    this.flush()
  }

  private flush(): void {
    if (this.busy || !this.pending) return
    const { canvas, edit, onDone } = this.pending
    this.pending = null
    const ctx = canvas.getContext('2d', { willReadFrequently: true })!
    const data = ctx.getImageData(0, 0, canvas.width, canvas.height)
    const id = ++this.seq
    this.callbacks.set(id, onDone)
    this.busy = true
    const req: WorkerRequest = { id, buf: data.data, w: canvas.width, h: canvas.height, edit }
    this.worker.postMessage(req, [data.data.buffer])
  }

  dispose(): void {
    this.worker.terminate()
  }
}
