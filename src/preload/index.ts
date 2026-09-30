import { contextBridge, ipcRenderer } from 'electron'

const desktop = {
  platform: process.platform,
  pickFolder: (): Promise<string | null> => ipcRenderer.invoke('pick-folder'),
  reveal: (path: string): Promise<void> => ipcRenderer.invoke('reveal', path),
  openExternal: (url: string): Promise<void> => ipcRenderer.invoke('open-external', url)
}

export type DesktopBridge = typeof desktop

contextBridge.exposeInMainWorld('desktop', desktop)
