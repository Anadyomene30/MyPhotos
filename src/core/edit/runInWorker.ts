import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { runFusion, type FusionRequest, type FusionResult } from './fusionJob'
import { runRender, type RenderRequest } from './renderJob'

function inWorker<T>(task: 'fusion' | 'render', req: unknown, inline: () => Promise<T>, workerDir: string, signal?: AbortSignal): Promise<T> {
  const file = join(workerDir, 'fusion-worker.js')
  if (signal?.aborted) return Promise.reject(new Error('aborted'))
  if (!existsSync(file)) return inline()
  return new Promise((resolve, reject) => {
    const w = new Worker(file)
    signal?.addEventListener('abort', () => {
      void w.terminate()
      reject(new Error('aborted'))
    }, { once: true })
    w.once('message', (m: { ok: boolean; result?: T; error?: string }) => {
      void w.terminate()
      if (m.ok) resolve(m.result!)
      else reject(new Error(m.error))
    })
    w.once('error', (e) => {
      void w.terminate()
      reject(e)
    })
    w.postMessage({ task, req })
  })
}

/** Run heavy pixel jobs in a worker thread when the bundled worker exists, inline otherwise (tests). */
export function fuseInWorker(req: FusionRequest, workerDir = import.meta.dirname, signal?: AbortSignal): Promise<FusionResult> {
  return inWorker('fusion', req, () => runFusion(req), workerDir, signal)
}

export function renderInWorker(req: RenderRequest, workerDir = import.meta.dirname): Promise<{ width: number; height: number }> {
  return inWorker('render', req, () => runRender(req), workerDir)
}
