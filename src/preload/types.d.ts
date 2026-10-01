export {}

type UpdateState =
  | { status: 'idle' | 'checking' | 'latest' }
  | { status: 'available'; version: string; url: string }
  | { status: 'downloading'; version: string; percent: number }
  | { status: 'ready'; version: string }
  | { status: 'error'; message: string }

declare global {
  interface Window {
    /** Present only inside the Electron desktop app, absent for LAN web clients. */
    desktop?: {
      platform: NodeJS.Platform | string
      pickFolder(labels?: { title?: string; button?: string }): Promise<string | null>
      pickFile(kind: 'audio' | 'any', labels?: { title?: string; filter?: string }): Promise<string | null>
      reveal(path: string): Promise<void>
      openExternal(url: string): Promise<void>
      update?: {
        get(): Promise<{ state: UpdateState; version: string; enabled: boolean }>
        check(): Promise<UpdateState>
        install(): Promise<void>
        onState(cb: (s: UpdateState) => void): () => void
      }
    }
  }
}
