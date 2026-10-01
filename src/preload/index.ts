import { contextBridge, ipcRenderer } from 'electron'

const desktop = {
  platform: process.platform,
  /** Labels come from the renderer, which knows the interface language. */
  pickFolder: (labels?: { title?: string; button?: string }): Promise<string | null> => ipcRenderer.invoke('pick-folder', labels),
  pickFile: (kind: 'audio' | 'any', labels?: { title?: string; filter?: string }): Promise<string | null> => ipcRenderer.invoke('pick-file', kind, labels),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('reveal', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url)
}

export type DesktopBridge = typeof desktop

contextBridge.exposeInMainWorld('desktop', desktop)
