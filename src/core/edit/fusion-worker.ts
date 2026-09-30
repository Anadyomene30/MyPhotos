import { parentPort } from 'node:worker_threads'
import { runFusion, type FusionRequest } from './fusionJob'
import { runRender, type RenderRequest } from './renderJob'

/** Worker thread for heavy pixel work: exposure fusion and full-resolution edit renders. */
parentPort?.on('message', (msg: { task: 'fusion'; req: FusionRequest } | { task: 'render'; req: RenderRequest }) => {
  const job = msg.task === 'render' ? runRender(msg.req) : runFusion(msg.req)
  job.then(
    (result) => parentPort?.postMessage({ ok: true, result }),
    (e: Error) => parentPort?.postMessage({ ok: false, error: e.message })
  )
})
