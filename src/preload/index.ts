import { contextBridge, ipcRenderer } from 'electron'
import type { UpdateState } from '../main/updater'

const desktop = {
  platform: process.platform,
  /** Labels come from the renderer, which knows the interface language. */
  pickFolder: (labels?: { title?: string; button?: string }): Promise<string | null> => ipcRenderer.invoke('pick-folder', labels),
  pickFile: (kind: 'audio' | 'any', labels?: { title?: string; filter?: string }): Promise<string | null> => ipcRenderer.invoke('pick-file', kind, labels),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('reveal', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url),
  update: {
    get: (): Promise<{ state: UpdateState; version: string; enabled: boolean }> => ipcRenderer.invoke('update-get'),
    check: (): Promise<UpdateState> => ipcRenderer.invoke('update-check'),
    /** Restart into a downloaded update, or open the download page when it cannot install itself. */
    install: (): Promise<void> => ipcRenderer.invoke('update-install'),
    onState(cb: (s: UpdateState) => void): () => void {
      const h = (_e: unknown, s: UpdateState): void => cb(s)
      ipcRenderer.on('update-state', h)
      return () => ipcRenderer.removeListener('update-state', h)
    }
  }
}

export type DesktopBridge = typeof desktop

contextBridge.exposeInMainWorld('desktop', desktop)
