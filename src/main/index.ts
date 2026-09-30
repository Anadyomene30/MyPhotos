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
      MYPHOTOS_DATA: join(app.getPath('userData'), 'library'),
      MYPHOTOS_RESOURCES: resources,
      MYPHOTOS_RENDERER_DIR: join(here, '../renderer'),
      ...(isDev ? { MYPHOTOS_DEV_ORIGIN: new URL(process.env.ELECTRON_RENDERER_URL!).origin } : {})
    }
  })
  backend = child
  const info = new Promise<BackendInfo>((resolve, reject) => {
    child.on('message', (m: { type?: string; port?: number; token?: string }) => {
      if (m?.type === 'ready' && m.port && m.token) resolve({ port: m.port, token: m.token })
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
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//.test(url) && !url.startsWith('http://127.0.0.1')) void shell.openExternal(url)
    return { action: 'deny' }
  })
  void loadApp(win)
  return win
}

ipcMain.handle('pick-folder', async () => {
  const r = await dialog.showOpenDialog(mainWindow!, {
    title: 'Choisir un dossier de photos',
    buttonLabel: 'Ajouter à la photothèque',
    properties: ['openDirectory', 'createDirectory']
  })
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
