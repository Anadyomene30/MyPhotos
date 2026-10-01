import { execFile } from 'node:child_process'
import { app, ipcMain, shell, type BrowserWindow } from 'electron'
import updaterPkg from 'electron-updater'

const { autoUpdater } = updaterPkg

/** Must match `publish` in electron-builder.yml. */
const REPO = 'Anadyomene30/MyPhotos'
const CHECK_EVERY = 6 * 3600_000

export type UpdateState =
  | { status: 'idle' | 'checking' | 'latest' }
  | { status: 'available'; version: string; url: string } // shown with a download link (unsigned Mac builds)
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string } // installs on restart
  | { status: 'error'; message: string }

let state: UpdateState = { status: 'idle' }
let getWindow: () => BrowserWindow | null = () => null

function set(s: UpdateState): void {
  state = s
  getWindow()?.webContents.send('update-state', s)
}

/**
 * Squirrel.Mac only installs an update signed by the same Developer ID as the running app.
 * Ad-hoc builds (no Apple Developer account yet) get a "download" notice instead.
 */
function canInstallInPlace(): Promise<boolean> {
  if (process.platform !== 'darwin') return Promise.resolve(true)
  return new Promise((resolve) => {
    execFile('codesign', ['-dv', app.getPath('exe')], (err, _out, stderr) => resolve(!err && !/Signature=adhoc/.test(stderr) && /Authority=Developer ID Application/.test(stderr)))
  })
}

export function setupUpdater(win: () => BrowserWindow | null): void {
  getWindow = win
  ipcMain.handle('update-get', () => ({ state, version: app.getVersion(), enabled: app.isPackaged }))
  ipcMain.handle('update-check', () => check())
  ipcMain.handle('update-install', () => {
    if (state.status === 'ready') autoUpdater.quitAndInstall()
    else if (state.status === 'available') void shell.openExternal(state.url)
  })
  if (!app.isPackaged) return

  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.on('checking-for-update', () => set({ status: 'checking' }))
  autoUpdater.on('update-not-available', () => set({ status: 'latest' }))
  autoUpdater.on('download-progress', (p) => {
    if (state.status === 'downloading') set({ ...state, percent: Math.round(p.percent) })
  })
  autoUpdater.on('update-downloaded', (info) => set({ status: 'ready', version: info.version }))
  autoUpdater.on('error', (e) => set({ status: 'error', message: e.message.split('\n')[0]!.slice(0, 200) }))

  void canInstallInPlace().then((inPlace) => {
    autoUpdater.autoDownload = inPlace
    autoUpdater.on('update-available', (info) => {
      if (inPlace) set({ status: 'downloading', version: info.version, percent: 0 })
      else set({ status: 'available', version: info.version, url: `https://github.com/${REPO}/releases/tag/v${info.version}` })
    })
    setTimeout(() => void check(), 15_000)
    setInterval(() => void check(), CHECK_EVERY).unref()
  })
}

async function check(): Promise<UpdateState> {
  if (!app.isPackaged) return state
  // keep a downloaded or announced update instead of checking again
  if (state.status === 'ready' || state.status === 'downloading') return state
  try {
    await autoUpdater.checkForUpdates()
  } catch (e) {
    set({ status: 'error', message: (e as Error).message.split('\n')[0]!.slice(0, 200) })
  }
  return state
}
