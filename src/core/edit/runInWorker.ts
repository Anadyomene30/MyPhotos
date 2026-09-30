import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import { runFusion, type FusionRequest, type FusionResult } from './fusionJob'

/** Run a fusion in a worker thread when the bundled worker exists, inline otherwise (tests). */
export function fuseInWorker(req: FusionRequest, workerDir = import.meta.dirname): Promise<FusionResult> {
  const file = join(workerDir, 'fusion-worker.js')
  if (!existsSync(file)) return runFusion(req)
  return new Promise((resolve, reject) => {
    const w = new Worker(file)
    w.once('message', (m: { ok: boolean; result?: FusionResult; error?: string }) => {
      void w.terminate()
      if (m.ok) resolve(m.result!)
      else reject(new Error(m.error))
    })
    w.once('error', (e) => {
      void w.terminate()
      reject(e)
    })
    w.postMessage(req)
  })
}
