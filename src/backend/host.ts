/**
 * Requests from the backend process to the Electron main process (things only Electron can do,
 * like moving files to the operating system trash). Absent when running headless.
 */
import { t } from '@shared/i18n'

type Parent = { postMessage(m: unknown): void; on(ev: 'message', fn: (e: { data: unknown }) => void): void }

const parent = (process as unknown as { parentPort?: Parent }).parentPort
let seq = 0
const pending = new Map<number, { resolve(v: unknown): void; reject(e: Error): void }>()

parent?.on('message', (e) => {
  const m = e.data as { type?: string; id?: number; ok?: boolean; result?: unknown; error?: string }
  if (m?.type !== 'host-reply' || m.id === undefined) return
  const p = pending.get(m.id)
  if (!p) return
  pending.delete(m.id)
  if (m.ok) p.resolve(m.result)
  else p.reject(new Error(m.error ?? 'host error'))
})

export const hasHost = Boolean(parent)

export function hostCall<T>(method: string, args: unknown): Promise<T> {
  if (!parent) return Promise.reject(new Error(t('Action disponible uniquement dans l’application de bureau')))
  const id = ++seq
  return new Promise<T>((resolve, reject) => {
    pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
    parent.postMessage({ type: 'host-call', id, method, args })
  })
}

export function notifyParent(message: unknown): void {
  parent?.postMessage(message)
}
