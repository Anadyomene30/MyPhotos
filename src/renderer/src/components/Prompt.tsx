import { t } from '@/i18n'
import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { Button } from './ui'
import { useModal } from './useModal'

interface PromptRequest {
  title: string
  placeholder?: string
  initial?: string
  confirmLabel: string
  resolve(v: string | null): void
}

const usePromptStore = create<{ req: PromptRequest | null; set(r: PromptRequest | null): void }>((set) => ({ req: null, set: (req) => set({ req }) }))

export function promptText(opts: Omit<PromptRequest, 'resolve'>): Promise<string | null> {
  return new Promise((resolve) => usePromptStore.getState().set({ ...opts, resolve }))
}

export function PromptHost() {
  const req = usePromptStore((s) => s.req)
  const set = usePromptStore((s) => s.set)
  const [value, setValue] = useState('')
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (req) {
      setValue(req.initial ?? '')
      setTimeout(() => input.current?.select(), 0)
    }
  }, [req])
  const panelRef = useModal<HTMLFormElement>(Boolean(req))
  if (!req) return null
  const close = (v: string | null): void => {
    req.resolve(v && v.trim() ? v.trim() : null)
    set(null)
  }
  return (
    <div className="animate-fade-in fixed inset-0 z-[60] grid place-items-center bg-black/35" onMouseDown={() => close(null)}>
      <form
        ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="prompt-title"
        className="animate-pop-in w-[380px] max-w-[92vw] rounded-sheet border border-line bg-elevated p-5"
        onMouseDown={(e) => e.stopPropagation()}
        onSubmit={(e) => {
          e.preventDefault()
          close(value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            e.stopPropagation()
            close(null)
          }
        }}
      >
        <h2 id="prompt-title" className="font-display text-[16px] font-semibold">{req.title}</h2>
        <input
          ref={input}
          autoFocus
          value={value}
          onChange={(e) => setValue(e.target.value)}
          placeholder={req.placeholder}
          className="mt-3 w-full rounded-card border border-line bg-bg px-3 py-2 text-[13px] outline-none focus:border-accent"
        />
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => close(null)}>{t('Annuler')}</Button>
          <Button variant="primary" type="submit" disabled={!value.trim()}>
            {req.confirmLabel}
          </Button>
        </div>
      </form>
    </div>
  )
}
