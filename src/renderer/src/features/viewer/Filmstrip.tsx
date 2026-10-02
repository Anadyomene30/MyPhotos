import { useEffect, useLayoutEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import clsx from 'clsx'
import { Play } from 'lucide-react'
import { media } from '@/api/client'
import { t } from '@/i18n'
import type { TileCache } from '@/features/library/tileCache'

const H = 40 // thumbnail height
const SLIVER = 22 // width of the neighbours
const GAP = 2
const AROUND = 6 // extra room on each side of the current item
const STEP = SLIVER + GAP

/** Left edge of item `d` steps away from the current one, relative to the strip centre. */
function leftOf(d: number, cw: number): number {
  if (d === 0) return -cw / 2
  if (d < 0) return -cw / 2 - AROUND - -d * SLIVER - (-d - 1) * GAP
  return cw / 2 + AROUND + (d - 1) * STEP
}

/**
 * iPhone-style film strip under the photo: narrow slivers of the neighbours, the current item wider at its own
 * aspect ratio. Click a sliver to jump, drag or swipe sideways to scrub through the library.
 */
export function Filmstrip({ cache, index, total, onSelect }: { cache: TileCache; index: number; total: number; onSelect(i: number): void }) {
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [scrubbing, setScrubbing] = useState(false)
  const drag = useRef<{ x: number; start: number; moved: boolean; id: number } | null>(null)
  const wheel = useRef(0)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setWidth(e!.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const reach = Math.ceil(width / 2 / STEP) + 3
  const from = Math.max(0, index - reach)
  const to = Math.min(total - 1, index + reach)
  useEffect(() => {
    cache.ensure(from, to)
  }, [cache, from, to])

  const current = cache.get(index)
  const cw = Math.round(Math.min(72, Math.max(28, H * (current?.ratio ?? 1))))

  const select = (i: number): void => {
    const next = Math.max(0, Math.min(total - 1, i))
    if (next !== index) onSelect(next)
  }

  const onDown = (e: RPointerEvent): void => {
    if (e.button !== 0) return
    drag.current = { x: e.clientX, start: index, moved: false, id: e.pointerId }
  }
  const onMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (!d) return
    const dx = e.clientX - d.x
    if (!d.moved && Math.abs(dx) < 4) return
    if (!d.moved) {
      d.moved = true
      setScrubbing(true)
      ref.current?.setPointerCapture(d.id)
    }
    // dragging left reveals later items, like pulling film through
    select(d.start - Math.round(dx / STEP))
  }
  const onUp = (e: RPointerEvent): void => {
    const d = drag.current
    drag.current = null
    setScrubbing(false)
    if (d && !d.moved) {
      const hit = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
      if (hit) select(Number(hit.dataset.index))
    }
  }
  const onWheel = (e: RWheelEvent): void => {
    const delta = Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY
    // a mouse wheel notch moves one photo; trackpad swipes accumulate
    if (e.deltaMode !== 0 || Math.abs(delta) >= 50) {
      wheel.current = 0
      select(index + Math.sign(delta))
      return
    }
    wheel.current += delta
    const steps = Math.trunc(wheel.current / 30)
    if (steps) {
      wheel.current -= steps * 30
      select(index + steps)
    }
  }

  if (total < 2) return null
  const items: number[] = []
  for (let j = from; j <= to; j++) items.push(j)

  return (
    <div
      ref={ref}
      role="navigation"
      aria-label={t('Pellicule')}
      className={clsx('relative h-[60px] shrink-0 touch-none overflow-hidden select-none', scrubbing ? 'cursor-grabbing' : 'cursor-pointer')}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={onUp}
      onPointerCancel={onUp}
      onWheel={onWheel}
    >
      {width > 0 &&
        items.map((j) => {
          const tile = cache.get(j)
          const d = j - index
          const isCurrent = d === 0
          return (
            <div
              key={j}
              data-index={j}
              title={isCurrent ? undefined : t('Photo {n} sur {total}', { n: (j + 1).toLocaleString(), total: total.toLocaleString() })}
              className={clsx(
                'absolute top-[10px] overflow-hidden bg-white/10',
                scrubbing ? 'duration-75' : 'duration-(--dh-motion-state)',
                'transition-[transform,width,border-radius,opacity]',
                isCurrent ? 'z-10 rounded-[4px] ring-1 ring-white/70' : 'rounded-[2px] opacity-75 hover:opacity-100'
              )}
              style={{ left: 0, height: H, width: isCurrent ? cw : SLIVER, transform: `translateX(${width / 2 + leftOf(d, cw)}px)` }}
            >
              {tile && <img src={media.thumb(tile.id, tile.v)} alt="" draggable={false} decoding="async" className="pointer-events-none size-full object-cover" />}
              {tile?.kind === 'video' && isCurrent && <Play className="pointer-events-none absolute right-1 bottom-1 size-2.5 fill-white text-white drop-shadow" />}
            </div>
          )
        })}
    </div>
  )
}
