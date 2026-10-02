import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

/** Menu anchored under a trigger element; closes on outside click or Escape. */
export function Popover({ anchor, open, onClose, children, align = 'end', width = 260 }: {
  anchor: HTMLElement | null
  open: boolean
  onClose(): void
  children: ReactNode
  align?: 'start' | 'end'
  width?: number
}) {
  const ref = useRef<HTMLDivElement>(null)
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null)

  useLayoutEffect(() => {
    if (!open || !anchor) return
    const r = anchor.getBoundingClientRect()
    const left = align === 'end' ? Math.max(8, r.right - width) : Math.min(window.innerWidth - width - 8, r.left)
    setPos({ top: r.bottom + 6, left })
  }, [open, anchor, align, width])

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent): void => {
      if (ref.current?.contains(e.target as Node) || anchor?.contains(e.target as Node)) return
      onClose()
    }
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        onClose()
      }
    }
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey, true)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey, true)
    }
  }, [open, onClose, anchor])

  if (!open || !pos) return null
  return createPortal(
    <div
      ref={ref}
      className="animate-pop-in fixed z-50 overflow-hidden rounded-card border border-line bg-elevated p-1"
      style={{ top: pos.top, left: pos.left, width }}
    >
      {children}
    </div>,
    document.body
  )
}

export function MenuItem({ children, onClick, danger, icon }: { children: ReactNode; onClick(): void; danger?: boolean; icon?: ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex w-full items-center gap-2.5 rounded-card px-2.5 py-1.5 text-left text-[13px] hover:bg-hover ${danger ? 'text-red-500' : ''}`}
    >
      {icon && <span className="text-muted">{icon}</span>}
      <span className="min-w-0 flex-1 truncate">{children}</span>
    </button>
  )
}

export function MenuSeparator() {
  return <div className="my-1 h-px bg-line" />
}
