export {}

declare global {
  interface Window {
    /** Present only inside the Electron desktop app, absent for LAN web clients. */
    desktop?: {
      platform: NodeJS.Platform | string
      pickFolder(labels?: { title?: string; button?: string }): Promise<string | null>
      pickFile(kind: 'audio' | 'any', labels?: { title?: string; filter?: string }): Promise<string | null>
      reveal(path: string): Promise<void>
      openExternal(url: string): Promise<void>
    }
  }
}
