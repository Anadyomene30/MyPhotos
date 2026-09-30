import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { FaceOut, WorkerMessage } from '../../ml/worker'

type Msg = WorkerMessage extends infer M ? (M extends { id: number } ? Omit<M, 'id'> : never) : never

type Pending = { resolve(v: unknown): void; reject(e: Error): void }

/** Talks to the ML worker thread; transfers pixel buffers to avoid copies. */
export class MlClient {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()
  ready = { faces: false, clip: false }

  constructor(private workerDir: string) {}

  get available(): boolean {
    return existsSync(join(this.workerDir, 'ml-worker.js'))
  }

  async start(modelsDir: string, faces: boolean, clip: boolean): Promise<void> {
    if (this.worker) return
    const file = join(this.workerDir, 'ml-worker.js')
    if (!existsSync(file)) throw new Error(`ML worker not built (${file})`)
    this.worker = new Worker(file)
    this.worker.on('message', (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
      const p = this.pending.get(m.id)
      if (!p) return
      this.pending.delete(m.id)
      if (m.ok) p.resolve(m.result)
      else p.reject(new Error(m.error ?? 'ml error'))
    })
    this.worker.on('error', (e) => this.failAll(e))
    this.worker.on('exit', () => {
      this.worker = null
      this.ready = { faces: false, clip: false }
      this.failAll(new Error('ML worker exited'))
    })
    const r = (await this.send({ type: 'init', modelsDir, faces, clip })) as { faces: boolean; clip: boolean }
    this.ready = r
  }

  private failAll(e: Error): void {
    for (const p of this.pending.values()) p.reject(e)
    this.pending.clear()
  }

  private send(msg: Msg, transfer: ArrayBuffer[] = []): Promise<unknown> {
    if (!this.worker) return Promise.reject(new Error('ML worker not running'))
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject })
      this.worker!.postMessage({ id, ...msg }, transfer)
    })
  }

  faces(rgb: Uint8Array, w: number, h: number): Promise<FaceOut[]> {
    return this.send({ type: 'faces', rgb, w, h }) as Promise<FaceOut[]>
  }

  clipImage(rgb: Uint8Array, w: number, h: number): Promise<Float32Array> {
    return this.send({ type: 'clip-image', rgb, w, h }, [rgb.buffer as ArrayBuffer]) as Promise<Float32Array>
  }

  clipTexts(texts: string[]): Promise<Float32Array[]> {
    return this.send({ type: 'clip-text', texts }) as Promise<Float32Array[]>
  }

  async stop(): Promise<void> {
    if (!this.worker) return
    try {
      await this.send({ type: 'dispose' })
    } catch {
      /* already gone */
    }
    await this.worker?.terminate()
    this.worker = null
    this.ready = { faces: false, clip: false }
  }
}
