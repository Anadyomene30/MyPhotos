import { app, BrowserWindow, dialog, ipcMain, nativeTheme, shell, utilityProcess, type UtilityProcess } from 'electron'
import { join } from 'node:path'

const isDev = !app.isPackaged && Boolean(process.env.ELECTRON_RENDERER_URL)
const here = import.meta.dirname

interface BackendInfo {
  port: number
  token: string
}

let backend: UtilityProcess | null = null
let backendInfo: Promise<BackendInfo> | null = null
let mainWindow: BrowserWindow | null = null
let quitting = false

function startBackend(): Promise<BackendInfo> {
  const resources = app.isPackaged ? process.resourcesPath : join(app.getAppPath(), 'resources')
  const child = utilityProcess.fork(join(here, 'backend.js'), [], {
    serviceName: 'MyPhotos Library',
    stdio: 'inherit',
    env: {
      ...process.env,
      // overridable for tests of the packaged app on a throwaway library
      MYPHOTOS_DATA: process.env.MYPHOTOS_DATA ?? join(app.getPath('userData'), 'library'),
      MYPHOTOS_RESOURCES: resources,
      MYPHOTOS_RENDERER_DIR: join(here, '../renderer'),
      MYPHOTOS_CREATIONS: process.env.MYPHOTOS_CREATIONS ?? join(app.getPath('pictures'), 'MyPhotos Créations'),
      ...(isDev ? { MYPHOTOS_DEV_ORIGIN: new URL(process.env.ELECTRON_RENDERER_URL!).origin, MYPHOTOS_TOKEN: 'dev' } : {})
    }
  })
  backend = child
  const info = new Promise<BackendInfo>((resolve, reject) => {
    child.on('message', (m: { type?: string; port?: number; token?: string; id?: number; method?: string; args?: unknown }) => {
      if (m?.type === 'ready' && m.port && m.token) resolve({ port: m.port, token: m.token })
      if (m?.type === 'host-call' && typeof m.id === 'number') void handleHostCall(child, m.id, m.method ?? '', m.args)
    })
    child.once('exit', (code) => {
      reject(new Error(`backend exited early (${code})`))
      if (!quitting) {
        // Crash recovery: restart and reload the window on the new port.
        backendInfo = startBackend()
        void backendInfo.then(() => mainWindow && loadApp(mainWindow))
      }
    })
  })
  return info
}

/** Render an app page to PDF in a hidden window (memory books). */
async function printPdf(url: string, outFile: string, format: 'square' | 'a4' | 'large'): Promise<string> {
  const win = new BrowserWindow({ show: false, width: 1200, height: 1200, webPreferences: { preload: join(here, '../preload/index.cjs'), sandbox: true, contextIsolation: true, offscreen: false } })
  try {
    await win.loadURL(url)
    await new Promise<void>((resolve) => {
      const check = async (): Promise<void> => {
        const ready = (await win.webContents.executeJavaScript('document.documentElement.dataset.printReady === "1"').catch(() => false)) as boolean
        if (ready) resolve()
        else setTimeout(() => void check(), 300)
      }
      void check()
      setTimeout(resolve, 60000)
    })
    const sizes = { square: { width: 8.27, height: 8.27 }, a4: 'A4' as const, large: { width: 11.8, height: 11.8 } }
    const size = sizes[format]
    const pdf = await win.webContents.printToPDF({ printBackground: true, preferCSSPageSize: false, margins: { top: 0, bottom: 0, left: 0, right: 0 }, pageSize: size, landscape: format === 'a4' })
    const { writeFile } = await import('node:fs/promises')
    await writeFile(outFile, pdf)
    return outFile
  } finally {
    win.destroy()
  }
}

/** Privileged operations requested by the backend process. */
async function handleHostCall(child: UtilityProcess, id: number, method: string, args: unknown): Promise<void> {
  try {
    let result: unknown
    if (method === 'trash' && Array.isArray(args)) {
      const failed: string[] = []
      for (const p of args) {
        try {
          await shell.trashItem(String(p))
        } catch {
          failed.push(String(p))
        }
      }
      result = failed
    } else if (method === 'print-pdf' && args && typeof args === 'object') {
      const { url, outFile, format } = args as { url: string; outFile: string; format: 'square' | 'a4' | 'large' }
      result = await printPdf(url, outFile, format)
    } else throw new Error(`unknown host method ${method}`)
    child.postMessage({ type: 'host-reply', id, ok: true, result })
  } catch (e) {
    child.postMessage({ type: 'host-reply', id, ok: false, error: (e as Error).message })
  }
}

async function loadApp(win: BrowserWindow): Promise<void> {
  const { port, token } = await backendInfo!
  const params = new URLSearchParams({ t: token })
  if (isDev) {
    params.set('api', `http://127.0.0.1:${port}`)
    await win.loadURL(`${process.env.ELECTRON_RENDERER_URL}/?${params}`)
  } else {
    await win.loadURL(`http://127.0.0.1:${port}/?${params}`)
  }
}

function createWindow(): BrowserWindow {
  const mac = process.platform === 'darwin'
  const win = new BrowserWindow({
    width: 1440,
    height: 920,
    minWidth: 900,
    minHeight: 600,
    show: false,
    title: 'MyPhotos',
    backgroundColor: nativeTheme.shouldUseDarkColors ? '#161618' : '#f6f6f7',
    titleBarStyle: mac ? 'hiddenInset' : 'hidden',
    trafficLightPosition: { x: 18, y: 18 },
    titleBarOverlay: mac ? undefined : { color: '#00000000', symbolColor: nativeTheme.shouldUseDarkColors ? '#e5e5e5' : '#1c1c1e', height: 44 },
    webPreferences: {
      preload: join(here, '../preload/index.cjs'),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false
    }
  })
  win.once('ready-to-show', () => win.show())
  if (isDev) {
    win.webContents.on('did-finish-load', () => console.log('[renderer] loaded', win.webContents.getURL().split('?')[0]))
    win.webContents.on('console-message', (e) => {
      if (e.level === 'error' || e.level === 'warning') console.log(`[renderer ${e.level}] ${e.message}`)
    })
    win.webContents.on('render-process-gone', (_e, d) => console.log('[renderer] gone', d.reason))
  }
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void loadApp(win)
  return win
}

const label = (v: unknown, max = 120): string | undefined => (typeof v === 'string' && v.trim() ? v.slice(0, max) : undefined)
type Labels = { title?: unknown; button?: unknown; filter?: unknown } | undefined

// the renderer sends translated labels; system defaults otherwise
ipcMain.handle('pick-folder', async (_e, labels: Labels) => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    title: label(labels?.title),
    buttonLabel: label(labels?.button, 40),
    properties: ['openDirectory', 'createDirectory']
  })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})
ipcMain.handle('pick-file', async (_e, kind: string, labels: Labels) => {
  const filters = kind === 'audio' ? [{ name: label(labels?.filter, 40) ?? 'Audio', extensions: ['mp3', 'm4a', 'aac', 'wav', 'flac', 'ogg', 'aiff'] }] : []
  const r = await dialog.showOpenDialog(mainWindow!, { title: label(labels?.title), properties: ['openFile'], filters })
  return r.canceled ? null : (r.filePaths[0] ?? null)
})
ipcMain.handle('reveal', (_e, path: string) => {
  if (typeof path === 'string') shell.showItemInFolder(path)
})
ipcMain.handle('open-external', (_e, url: string) => {
  if (typeof url === 'string' && /^https?:\/\//.test(url)) void shell.openExternal(url)
})

if (!app.requestSingleInstanceLock()) app.quit()
else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    backendInfo = startBackend()
    mainWindow = createWindow()
    mainWindow.on('closed', () => (mainWindow = null))
    app.on('activate', () => {
      if (!mainWindow) {
        mainWindow = createWindow()
        mainWindow.on('closed', () => (mainWindow = null))
      }
    })
  })

  app.on('before-quit', () => {
    quitting = true
    backend?.kill()
  })
  app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') app.quit()
  })
}
