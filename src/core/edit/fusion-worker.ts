import { parentPort } from 'node:worker_threads'
import { runFusion, type FusionRequest } from './fusionJob'

parentPort?.on('message', (req: FusionRequest) => {
  runFusion(req).then(
    (result) => parentPort?.postMessage({ ok: true, result }),
    (e: Error) => parentPort?.postMessage({ ok: false, error: e.message })
  )
})
