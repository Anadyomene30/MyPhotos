import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, FolderOpen, Heart, Info, RotateCcw, Share, Trash2 } from 'lucide-react'
import { media } from '@/api/client'
import { patchAssets, useAsset, useBuckets, useTileCache, useTimelineQuery } from '@/api/hooks'
import { useUi } from '@/store'
import { IconButton } from '@/components/ui'
import { dateTime } from '@/lib/format'
import { trashWithUndo } from '@/features/library/Timeline'
import { InfoPanel } from './InfoPanel'
import type { AssetDetail, AssetTile } from '@shared/types'

export function Viewer() {
  const index = useUi((s) => s.viewerIndex)
  const q = useTimelineQuery()
  const cache = useTileCache(q)
  const { data: buckets } = useBuckets(q)
  const total = buckets?.reduce((a, b) => a + b.count, 0) ?? 0
  const infoOpen = useUi((s) => s.infoOpen)
  const { closeViewer, openViewer, toggleInfo } = useUi.getState()

  const i = index ?? 0
  const tile = cache.get(i)
  const { data: detail } = useAsset(tile?.id)

  useEffect(() => {
    cache.ensure(Math.max(0, i - 6), Math.min(total - 1, i + 6))
  }, [cache, i, total])

  // Preload neighbours so arrow navigation feels instant.
  useEffect(() => {
    for (const d of [1, -1, 2]) {
      const t = cache.get(i + d)
      if (t && t.kind === 'photo') new Image().src = media.preview(t.id, t.v)
    }
  }, [cache, i, tile])

  // Keep the index valid when the list shrinks (e.g. after deleting the last item).
  useEffect(() => {
    if (index !== null && total > 0 && index >= total) openViewer(total - 1)
    if (index !== null && total === 0 && buckets) closeViewer()
  }, [index, total, buckets, openViewer, closeViewer])

  const go = useCallback((d: number) => {
    const next = i + d
    if (next >= 0 && next < total) openViewer(next)
  }, [i, total, openViewer])

  const inTrash = q.filter === 'trash'
  const toggleFavorite = useCallback(() => {
    if (tile) void patchAssets([tile.id], { favorite: !tile.favorite })
  }, [tile])
  const trash = useCallback(() => {
    if (tile) void trashWithUndo([tile.id], inTrash)
  }, [tile, inTrash])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input, textarea')) return
      if (e.key === 'Escape') closeViewer()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if (useUi.getState().exportIds) return
      else if (e.key === 'i' || e.key === 'I') toggleInfo()
      else if (e.key === '.') toggleFavorite()
      else if (e.key === 'Backspace' || e.key === 'Delete') trash()
      else if (e.key === ' ' && tile?.kind !== 'video') {
        e.preventDefault()
        closeViewer()
      } else return
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [go, closeViewer, toggleInfo, toggleFavorite, trash, tile])

  const when = detail ? dateTime(detail.takenAt, detail.tzOffset) : tile ? dateTime(tile.takenAt, null) : null
  const desktop = window.desktop

  return (
    <div className="animate-fade-in fixed inset-0 z-40 flex bg-[#0b0b0c] text-white">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag absolute inset-x-0 top-0 z-10 flex h-[52px] items-center gap-2 bg-gradient-to-b from-black/60 to-transparent pr-4 pl-[84px]">
          <button onClick={closeViewer} className="no-drag flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-white/85 hover:bg-white/10">
            <ChevronLeft className="size-4" /> Retour
          </button>
          <div className="min-w-0 flex-1 text-center">
            {when && (
              <>
                <div className="truncate text-[13px] font-semibold">{when.date}</div>
                <div className="text-[11.5px] text-white/60">{when.time}</div>
              </>
            )}
          </div>
          <div className="no-drag flex items-center gap-0.5 [&_button]:text-white/80 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            {!inTrash && (
              <IconButton label="Favori (.)" onClick={toggleFavorite}>
                <Heart className={clsx('size-[18px]', tile?.favorite && 'fill-heart text-heart')} />
              </IconButton>
            )}
            {tile && (
              <IconButton label="Exporter" onClick={() => useUi.getState().setExportIds([tile.id])}>
                <Share className="size-[18px]" />
              </IconButton>
            )}
            <IconButton label="Informations (i)" onClick={toggleInfo} active={infoOpen}>
              <Info className="size-[18px]" />
            </IconButton>
            {desktop && detail ? (
              <IconButton label="Afficher dans le dossier" onClick={() => void desktop.reveal(detail.path)}>
                <FolderOpen className="size-[18px]" />
              </IconButton>
            ) : (
              tile && (
                <a href={media.download(tile.id)} className="grid size-8 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white" title="Télécharger">
                  <Download className="size-[18px]" />
                </a>
              )
            )}
            <IconButton label={inTrash ? 'Restaurer' : 'Supprimer (⌫)'} onClick={trash}>
              {inTrash ? <RotateCcw className="size-[18px]" /> : <Trash2 className="size-[18px]" />}
            </IconButton>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden">
          {tile && <Stage key={tile.id} tile={tile} detail={detail?.id === tile.id ? detail : undefined} />}
          {i > 0 && (
            <NavButton side="left" onClick={() => go(-1)} />
          )}
          {i < total - 1 && <NavButton side="right" onClick={() => go(1)} />}
        </div>
      </div>
      {infoOpen && detail && <InfoPanel detail={detail} />}
    </div>
  )
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick(): void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? 'Précédent' : 'Suivant'}
      className={clsx(
        'group absolute top-1/2 grid h-24 w-14 -translate-y-1/2 place-items-center opacity-0 transition-opacity hover:opacity-100',
        side === 'left' ? 'left-0' : 'right-0'
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-black/40 backdrop-blur-md">
        <Icon className="size-5" />
      </span>
    </button>
  )
}

/** Photo or video area with fit-to-screen, double-click zoom, wheel/pinch zoom and drag panning. */
function Stage({ tile, detail }: { tile: AssetTile; detail: AssetDetail | undefined }) {
  const [loaded, setLoaded] = useState(false)
  const [scale, setScale] = useState(1)
  const [pan, setPan] = useState({ x: 0, y: 0 })
  const [liveOn, setLiveOn] = useState(false)
  const drag = useRef<{ x: number; y: number; px: number; py: number } | null>(null)

  const onWheel = (e: RWheelEvent): void => {
    if (tile.kind === 'video') return
    if (!e.ctrlKey && scale === 1) return
    const next = Math.max(1, Math.min(8, scale * (e.deltaY < 0 ? 1.08 : 1 / 1.08)))
    setScale(next)
    if (next === 1) setPan({ x: 0, y: 0 })
  }
  const onDouble = (): void => {
    if (tile.kind === 'video') return
    if (scale > 1) {
      setScale(1)
      setPan({ x: 0, y: 0 })
    } else setScale(2.5)
  }
  const onDown = (e: RPointerEvent): void => {
    if (scale === 1) return
    drag.current = { x: e.clientX, y: e.clientY, px: pan.x, py: pan.y }
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
  }
  const onMove = (e: RPointerEvent): void => {
    const d = drag.current
    if (d) setPan({ x: d.px + (e.clientX - d.x) / scale, y: d.py + (e.clientY - d.y) / scale })
  }

  if (tile.kind === 'video') {
    if (detail && !detail.webNative) {
      return (
        <div className="grid h-full place-items-center text-center text-white/70">
          <div>
            <img src={media.thumb(tile.id, tile.v)} alt="" className="mx-auto mb-4 max-h-64 rounded-lg opacity-80" />
            Ce format vidéo ({detail.ext.toUpperCase()}) sera lisible après conversion.
          </div>
        </div>
      )
    }
    return (
      <div className="grid h-full place-items-center p-6 pt-14">
        <video key={tile.id} src={media.original(tile.id)} poster={media.thumb(tile.id, tile.v)} controls autoPlay playsInline className="max-h-full max-w-full rounded-sm bg-black shadow-2xl" />
      </div>
    )
  }

  return (
    <div
      className={clsx('absolute inset-0 grid place-items-center overflow-hidden p-4 pt-14', scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')}
      onWheel={onWheel}
      onDoubleClick={onDouble}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
    >
      <div
        className="relative grid h-full w-full place-items-center transition-transform duration-150 ease-out"
        style={{ transform: `scale(${scale}) translate(${pan.x}px, ${pan.y}px)` }}
      >
        {!loaded && <img src={media.thumb(tile.id, tile.v)} alt="" draggable={false} className="absolute max-h-full max-w-full object-contain blur-[2px]" style={{ aspectRatio: tile.ratio, height: '100%' }} />}
        <img
          src={media.preview(tile.id, tile.v)}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          className={clsx('max-h-full max-w-full object-contain transition-opacity duration-200', loaded ? 'opacity-100' : 'opacity-0')}
        />
        {liveOn && detail?.hasLiveVideo && (
          <video src={media.live(tile.id)} autoPlay muted playsInline onEnded={() => setLiveOn(false)} className="absolute max-h-full max-w-full object-contain" />
        )}
      </div>
      {tile.live && (
        <button
          onMouseEnter={() => setLiveOn(true)}
          onMouseLeave={() => setLiveOn(false)}
          onClick={() => setLiveOn(true)}
          className="absolute top-16 left-4 rounded-md bg-black/45 px-2 py-1 text-[11px] font-bold tracking-wider text-white backdrop-blur-md"
        >
          LIVE
        </button>
      )}
    </div>
  )
}
