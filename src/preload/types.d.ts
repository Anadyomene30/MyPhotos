export {}

declare global {
  interface Window {
    /** Present only inside the Electron desktop app, absent for LAN web clients. */
    desktop?: {
      platform: NodeJS.Platform | string
      pickFolder(): Promise<string | null>
      pickFile(kind: 'audio' | 'any'): Promise<string | null>
      reveal(path: string): Promise<void>
      openExternal(url: string): Promise<void>
    }
  }
}
