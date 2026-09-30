import { useEffect } from 'react'
import { create } from 'zustand'
import { Button } from './ui'

interface ConfirmRequest {
  title: string
  message: string
  confirmLabel: string
  danger?: boolean
  resolve(ok: boolean): void
}

const useConfirmStore = create<{ req: ConfirmRequest | null; set(r: ConfirmRequest | null): void }>((set) => ({ req: null, set: (req) => set({ req }) }))

/** Promise-based confirmation dialog: `if (await confirm({...})) doIt()` */
export function confirm(opts: Omit<ConfirmRequest, 'resolve'>): Promise<boolean> {
  return new Promise((resolve) => useConfirmStore.getState().set({ ...opts, resolve }))
}

export function ConfirmHost() {
  const req = useConfirmStore((s) => s.req)
  const set = useConfirmStore((s) => s.set)
  const close = (ok: boolean): void => {
    req?.resolve(ok)
    set(null)
  }
  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close(false)
      else if (e.key === 'Enter') close(true)
      else return
      e.stopImmediatePropagation()
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })
  if (!req) return null
  return (
    <div className="animate-fade-in fixed inset-0 z-[60] grid place-items-center bg-black/35 backdrop-blur-[2px]" onMouseDown={() => close(false)}>
      <div className="animate-pop-in w-[400px] max-w-[92vw] rounded-2xl border border-line bg-surface p-5 shadow-2xl dark:bg-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <h2 className="font-display text-[16px] font-semibold">{req.title}</h2>
        <p className="mt-2 text-[13px] leading-relaxed text-muted">{req.message}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button onClick={() => close(false)}>Annuler</Button>
          <Button variant={req.danger ? 'danger' : 'primary'} onClick={() => close(true)} autoFocus>
            {req.confirmLabel}
          </Button>
        </div>
      </div>
    </div>
  )
}
