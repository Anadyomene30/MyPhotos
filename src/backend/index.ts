import { randomBytes } from 'node:crypto'
import { homedir } from 'node:os'
import { join, resolve } from 'node:path'
import { serve } from '@hono/node-server'
import { Library } from '@core/library'
import { defaultAppDataDir, presetFile } from '@core/household'
import { createApp } from '../server/app'
import { hostCall, notifyParent } from './host'
import { createGuestApp } from '../server/guest'
import { LanServer } from './lan'

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
  appUrl: () => `http://127.0.0.1:${listeningPort}/?t=${token}`,
  // the launcher's household pre-setting; Electron passes app.getPath('appData'), headless runs use the same place
  householdPreset: process.env.MYPHOTOS_HOUSEHOLD_PRESET || presetFile(defaultAppDataDir())
})
let listeningPort = preferredPort
const guest = createGuestApp(lib, { rendererDir, ownerName: () => lib.ownerName })
const lan = new LanServer(guest, parseInt(process.env.MYPHOTOS_LAN_PORT ?? '47810', 10))
const lanEnabled = (): boolean => lib.setting('lan_enabled') === '1'
const publishLan = (): void => {
  lib.emit('event', { type: 'lan-status', status: lan.status(lanEnabled()) })
}
const app = createApp(lib, {
  token,
  rendererDir,
  devOrigin: process.env.MYPHOTOS_DEV_ORIGIN,
  lan: {
    status: () => lan.status(lanEnabled()),
    setEnabled: async (on: boolean) => {
      lib.setSetting('lan_enabled', on ? '1' : '0')
      if (on) await lan.start()
      else await lan.stop()
      publishLan()
      return lan.status(on)
    }
  }
})
if (lanEnabled()) void lan.start().then(publishLan)

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
