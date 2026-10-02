import { t, tn } from '@/i18n'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type DragEvent, type MouseEvent } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { api, media, qs } from '@/api/client'
import { DRAG_MIME, setDragImage } from '@/features/albums/drag'
import { patchAssets, useBuckets, useTileCache, useTimelineQuery } from '@/api/hooks'
import { useUi, ZOOM_LEVELS } from '@/store'
import { buildLayout, rowOfIndex, SIDE_PADDING, type Layout } from './layout'
import { Tile } from './Tile'
import { GroupHeader, groupTitle } from './GroupHeader'
import { EmptySection } from './EmptySection'
import { YearScrubber } from './YearScrubber'
import { useScrollLabel } from './scrollLabel'
import { queryParams, type TileCache } from './tileCache'

export const TOOLBAR_HEIGHT = 52

export function Timeline() {
  const q = useTimelineQuery()
  const { data: buckets, isFetched } = useBuckets(q)
  const cache = useTileCache(q)
  const grouping = useUi((s) => s.grouping)
  const zoom = useUi((s) => s.zoom)
  const aspectGrid = useUi((s) => s.aspectGrid)
  const selection = useUi((s) => s.selection)
  const viewerOpen = useUi((s) => s.viewerIndex !== null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)

  useLayoutEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const measure = (): void => setWidth(el.clientWidth)
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    measure()
    // seen once after a launch: the observer missed the window's resize and the grid stayed one narrow column
    window.addEventListener('resize', measure)
    document.addEventListener('visibilitychange', measure)
    return () => {
      ro.disconnect()
      window.removeEventListener('resize', measure)
      document.removeEventListener('visibilitychange', measure)
    }
  }, [])
  // and a stale width is corrected as soon as the view changes
  useLayoutEffect(() => {
    const el = scrollRef.current
    if (el && el.clientWidth !== width) setWidth(el.clientWidth)
  }, [q])

  const layout = useMemo(() => buildLayout(buckets ?? [], grouping, width, ZOOM_LEVELS[zoom]!), [buckets, grouping, width, zoom])
  const compact = layout.cell < 72

  const virtualizer = useVirtualizer({
    count: layout.rows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: (i) => layout.rows[i]!.height,
    overscan: 4,
    paddingStart: TOOLBAR_HEIGHT,
    paddingEnd: 48
  })

  // Keep the first visible photo in place when zoom or grouping changes.
  const anchorIndex = useRef(0)
  const prevLayout = useRef<Layout | null>(null)
  useLayoutEffect(() => {
    virtualizer.measure()
    const prev = prevLayout.current
    prevLayout.current = layout
    if (prev && (prev.columns !== layout.columns || prev.rows.length !== layout.rows.length) && anchorIndex.current > 0) {
      virtualizer.scrollToIndex(rowOfIndex(layout, anchorIndex.current), { align: 'start' })
    }
  }, [layout, virtualizer])

  const items = virtualizer.getVirtualItems()
  const setLabel = useScrollLabel((s) => s.set)

  useEffect(() => {
    let first = Infinity
    let last = -1
    let topGroup: number | null = null
    const scrollTop = virtualizer.scrollOffset ?? 0
    for (const it of items) {
      const r = layout.rows[it.index]
      if (!r) continue
      if (topGroup === null && it.end > scrollTop + TOOLBAR_HEIGHT) topGroup = r.group
      if (r.type === 'tiles') {
        first = Math.min(first, r.start)
        last = Math.max(last, r.start + r.count - 1)
        if (it.start >= scrollTop && anchorIndex.current !== r.start && it.start - scrollTop < it.size + TOOLBAR_HEIGHT) anchorIndex.current = r.start
      }
    }
    if (last >= 0) cache.ensure(first, last)
    const g = topGroup !== null ? layout.groups[topGroup] : undefined
    setLabel(g && (virtualizer.scrollOffset ?? 0) > 8 ? (g.title ?? groupTitle(g.key, grouping)) : null)
  }, [items, layout, cache, grouping, setLabel, virtualizer.scrollOffset])

  // Scroll to top when the section changes.
  const qKey = JSON.stringify(queryParams(q))
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: 0 })
    anchorIndex.current = 0
  }, [qKey])

  // Trackpad pinch (ctrl+wheel) and ctrl/cmd +/- zoom.
  const pinch = useRef(0)
  useEffect(() => {
    const el = scrollRef.current
    if (!el) return
    const onWheel = (e: WheelEvent): void => {
      if (!e.ctrlKey) return
      e.preventDefault()
      pinch.current += e.deltaY
      if (Math.abs(pinch.current) > 28) {
        const ui = useUi.getState()
        ui.setZoom(ui.zoom + (pinch.current < 0 ? 1 : -1))
        pinch.current = 0
      }
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const onClick = useCallback(
    (e: MouseEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
      const ui = useUi.getState()
      if (!el) {
        if (!e.metaKey && !e.ctrlKey && !e.shiftKey) ui.clearSelection()
        return
      }
      const index = Number(el.dataset.index)
      const tile = cache.get(index)
      if (!tile) return
      if (e.shiftKey && ui.anchor !== null) {
        void selectRange(cache, ui.anchor, index, e.metaKey || e.ctrlKey)
      } else if (e.metaKey || e.ctrlKey) {
        ui.select([tile.id], 'toggle', index)
      } else {
        ui.select([tile.id], 'replace', index)
      }
    },
    [cache]
  )

  const onDragStart = useCallback(
    (e: DragEvent) => {
      const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
      const index = el ? Number(el.dataset.index) : NaN
      const tile = Number.isNaN(index) ? undefined : cache.get(index)
      if (!tile) return
      const ui = useUi.getState()
      let ids = [...ui.selection]
      if (!ui.selection.has(tile.id)) {
        ui.select([tile.id], 'replace', index)
        ids = [tile.id]
      }
      e.dataTransfer.effectAllowed = 'copy'
      e.dataTransfer.setData(DRAG_MIME, JSON.stringify(ids))
      setDragImage(e.dataTransfer, media.thumb(tile.id, tile.v), ids.length)
    },
    [cache]
  )

  const onDoubleClick = useCallback((e: MouseEvent) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-index]')
    if (el) useUi.getState().openViewer(Number(el.dataset.index))
  }, [])

  useTimelineKeys(cache, layout, virtualizer.scrollToIndex, viewerOpen)

  const scrollToGroup = useCallback(
    (groupIndex: number) => {
      const row = layout.rows.findIndex((r) => r.type === 'header' && r.group === groupIndex)
      if (row >= 0) virtualizer.scrollToIndex(row, { align: 'start' })
    },
    [layout, virtualizer]
  )

  if (isFetched && layout.total === 0) return <EmptySection />

  return (
    <div className="relative h-full">
      <div ref={scrollRef} className="scroll-thin h-full overflow-y-auto overflow-x-hidden" onClick={onClick} onDoubleClick={onDoubleClick} onDragStart={onDragStart}>
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {items.map((it) => {
            const r = layout.rows[it.index]!
            return (
              <div
                key={it.key}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', height: it.size, transform: `translateY(${it.start}px)` }}
              >
                {r.type === 'header' ? (
                  <GroupHeader group={layout.groups[r.group]!} grouping={grouping} />
                ) : (
                  <div className="flex" style={{ gap: layout.gap, paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}>
                    {Array.from({ length: r.count }, (_, k) => {
                      const index = r.start + k
                      const tile = cache.get(index)
                      return <Tile key={index} tile={tile} index={index} size={layout.cell} selected={tile ? selection.has(tile.id) : false} compact={compact} fit={aspectGrid} />
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
      <YearScrubber groups={layout.groups} grouping={grouping} onJump={scrollToGroup} />
    </div>
  )
}

async function selectRange(cache: TileCache, a: number, b: number, additive: boolean): Promise<void> {
  const [lo, hi] = a < b ? [a, b] : [b, a]
  await cache.fetchRange(lo, hi)
  const ids: number[] = []
  for (let i = lo; i <= hi; i++) {
    const t = cache.get(i)
    if (t) ids.push(t.id)
  }
  useUi.getState().select(ids, additive ? 'add' : 'replace')
}

function useTimelineKeys(cache: TileCache, layout: Layout, scrollToRow: (i: number, o?: { align?: 'auto' | 'start' | 'center' | 'end' }) => void, disabled: boolean) {
  useEffect(() => {
    if (disabled) return
    const onKey = async (e: KeyboardEvent): Promise<void> => {
      const target = e.target as HTMLElement
      if (target.closest('input, textarea, [contenteditable="true"]')) return
      const ui = useUi.getState()
      const mod = e.metaKey || e.ctrlKey
      const selected = [...ui.selection]

      if (ui.exportIds || ui.smartEditor || ui.settingsOpen) return
      if (e.key === 'Escape') ui.clearSelection()
      else if (mod && e.key.toLowerCase() === 'e' && selected.length) {
        e.preventDefault()
        ui.setExportIds(selected)
      }
      else if (mod && e.key.toLowerCase() === 'a') {
        e.preventDefault()
        const q = cache.query
        const ids = await api<number[]>(`/api/timeline/ids${qs(queryParams(q))}`)
        ui.select(ids, 'replace')
      } else if ((e.key === 'Enter' || e.key === ' ') && ui.anchor !== null) {
        e.preventDefault()
        ui.openViewer(ui.anchor)
      } else if ((e.key === 'Backspace' || e.key === 'Delete') && selected.length) {
        e.preventDefault()
        await trashWithUndo(selected, cache.query.filter === 'trash')
        ui.clearSelection()
      } else if (e.key === '.' && selected.length) {
        const allFav = selected.every((id) => findTile(cache, layout, id)?.favorite)
        await patchAssets(selected, { favorite: !allFav })
      } else if (!mod && (e.key === '1' || e.key === '2' || e.key === '3' || e.key === '4')) {
        ui.setGrouping(e.key === '1' ? 'year' : e.key === '2' ? 'month' : e.key === '3' ? 'day' : 'moments')
      } else if ((mod && (e.key === '=' || e.key === '+')) || (!mod && e.key === '+')) {
        e.preventDefault()
        ui.setZoom(ui.zoom + 1)
      } else if ((mod && e.key === '-') || (!mod && e.key === '-')) {
        e.preventDefault()
        ui.setZoom(ui.zoom - 1)
      } else if (e.key.startsWith('Arrow') && layout.total > 0) {
        e.preventDefault()
        const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowDown' ? layout.columns : -layout.columns
        const next = Math.max(0, Math.min(layout.total - 1, (ui.anchor ?? -1) + step))
        await cache.fetchRange(next, next)
        const t = cache.get(next)
        if (!t) return
        if (e.shiftKey) ui.select([t.id], 'add', next)
        else ui.select([t.id], 'replace', next)
        scrollToRow(rowOfIndex(layout, next), { align: 'auto' })
      }
    }
    const handler = (e: KeyboardEvent): void => void onKey(e)
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [cache, layout, scrollToRow, disabled])
}

function findTile(cache: TileCache, layout: Layout, id: number) {
  for (let i = 0; i < layout.total; i++) {
    const t = cache.get(i)
    if (t?.id === id) return t
  }
  return undefined
}

export async function trashWithUndo(ids: number[], restoring: boolean): Promise<void> {
  const ui = useUi.getState()
  await patchAssets(ids, { trashed: !restoring })
  const n = ids.length
  ui.toast(restoring ? tn(n, '{n} élément restauré', '{n} éléments restaurés') : tn(n, '{n} élément placé dans la corbeille', '{n} éléments placés dans la corbeille'), {
    label: t('Annuler'),
    run: () => void patchAssets(ids, { trashed: restoring })
  })
}
