import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Library } from '@core/library'
import { createApp } from '../server/app'
import { hostCall, notifyParent } from './host'

/**
 * Backend entry. Runs inside an Electron utilityProcess (production) or as a plain Node process
 * (`npm run serve`, headless development in a browser). Owns the database, indexing and the HTTP API.
 */
const dataDir = resolve(process.env.MYPHOTOS_DATA ?? join(homedir(), '.myphotos-dev'))
const token = process.env.MYPHOTOS_TOKEN ?? randomBytes(24).toString('hex')
const preferredPort = parseInt(process.env.MYPHOTOS_PORT ?? '47800', 10)
const rendererDir = process.env.MYPHOTOS_RENDERER_DIR ?? resolve(import.meta.dirname, '../renderer')

const lib = new Library({
  dataDir,
  creationsDir: process.env.MYPHOTOS_CREATIONS,
  resourcesDir: process.env.MYPHOTOS_RESOURCES ?? resolve(process.cwd(), 'resources'),
  workerDir: import.meta.dirname,
  moveToSystemTrash: (paths) => hostCall<string[]>('trash', paths),
  printPdf: (url, outFile, format) => hostCall<string>('print-pdf', { url, outFile, format }),
  appUrl: () => `http://127.0.0.1:${listeningPort}/?t=${token}`
})
let listeningPort = preferredPort
const app = createApp(lib, { token, rendererDir, devOrigin: process.env.MYPHOTOS_DEV_ORIGIN })

function listen(port: number): Promise<number> {
  return new Promise((ok, fail) => {
    const server = serve({ fetch: app.fetch, hostname: '127.0.0.1', port }, (info) => ok(info.port))
    server.on('error', (e: NodeJS.ErrnoException) => (e.code === 'EADDRINUSE' && port !== 0 ? listen(0).then(ok, fail) : fail(e)))
  })
}

const port = await listen(preferredPort)
listeningPort = port
if ((process as unknown as { parentPort?: unknown }).parentPort) notifyParent({ type: 'ready', port, token })
else console.log(`MyPhotos backend on http://127.0.0.1:${port}/?t=${token}  (data: ${dataDir})`)

const shutdown = (): void => {
  lib.close()
  process.exit(0)
}
process.on('SIGTERM', shutdown)
process.on('SIGINT', shutdown)

void lib.start()
