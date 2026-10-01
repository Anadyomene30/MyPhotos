import { useEffect, useRef, type RefObject } from 'react'

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'

/**
 * Accessible modal behaviour for a dialog panel: moves focus inside when it opens (an `autoFocus` element wins),
 * keeps Tab / Shift+Tab inside, and gives focus back to what had it when the dialog closes.
 * Pair with `role="dialog" aria-modal="true" aria-label(ledby)` on the same element.
 */
export function useModal<T extends HTMLElement>(open = true): RefObject<T | null> {
  const ref = useRef<T>(null)
  useEffect(() => {
    if (!open) return
    const panel = ref.current
    if (!panel) return
    const previous = document.activeElement as HTMLElement | null
    const focusables = (): HTMLElement[] => [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((el) => el.offsetParent !== null || el === document.activeElement)
    // let autoFocus run first, then make sure focus is inside
    const raf = requestAnimationFrame(() => {
      if (!panel.contains(document.activeElement)) (focusables()[0] ?? panel).focus({ preventScroll: true })
    })
    if (!panel.hasAttribute('tabindex')) panel.setAttribute('tabindex', '-1')
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Tab') return
      const list = focusables()
      if (!list.length) {
        e.preventDefault()
        return
      }
      const first = list[0]!
      const last = list[list.length - 1]!
      if (e.shiftKey && (document.activeElement === first || !panel.contains(document.activeElement))) {
        e.preventDefault()
        last.focus()
      } else if (!e.shiftKey && (document.activeElement === last || !panel.contains(document.activeElement))) {
        e.preventDefault()
        first.focus()
      }
    }
    document.addEventListener('keydown', onKey, true)
    return () => {
      cancelAnimationFrame(raf)
      document.removeEventListener('keydown', onKey, true)
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [open])
  return ref
}
