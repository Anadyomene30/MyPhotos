import { useCallback, useEffect, useRef, useState, type PointerEvent as RPointerEvent, type WheelEvent as RWheelEvent } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, FolderOpen, Heart, Info, RotateCcw, ScanFace, Share, SlidersHorizontal, Sparkles, Trash2, Undo2, Unlink } from 'lucide-react'
import { FacesOverlay } from '@/features/people/FacesOverlay'
import { useMlStatus } from '@/api/hooks'
import { useState as useLocalState } from 'react'
import { api } from '@/api/client'
import { media } from '@/api/client'
import { patchAssets, useAsset, useBuckets, useTileCache, useTimelineQuery } from '@/api/hooks'
import { useUi } from '@/store'
import { t } from '@/i18n'
import { IconButton } from '@/components/ui'
import { dateTime } from '@/lib/format'
import { trashWithUndo } from '@/features/library/Timeline'
import { InfoPanel } from './InfoPanel'
import { Filmstrip } from './Filmstrip'
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
  const [versionId, setVersionId] = useLocalState<number | null>(null)
  useEffect(() => setVersionId(null), [tile?.id])
  const version = detail?.versionList.find((v) => v.id === versionId)
  const shownTile = tile && version ? { ...tile, id: version.id, v: version.v, live: false } : tile
  const { data: shownDetail } = useAsset(shownTile?.id)
  const { data: ml } = useMlStatus()
  const [facesOn, setFacesOn] = useLocalState(false)

  useEffect(() => {
    cache.ensure(Math.max(0, i - 6), Math.min(total - 1, i + 6))
  }, [cache, i, total])

  // Preload neighbours so arrow navigation feels instant.
  useEffect(() => {
    for (const d of [1, -1, 2]) {
      const nb = cache.get(i + d)
      if (nb && nb.kind === 'photo') new Image().src = media.preview(nb.id, nb.v)
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
      const ui = useUi.getState()
      if (ui.exportIds || ui.editorId !== null || ui.videoEditorId !== null) return
      if (e.key === 'Escape') closeViewer()
      else if (e.key === 'ArrowRight') go(1)
      else if (e.key === 'ArrowLeft') go(-1)
      else if ((e.key === 'e' || e.key === 'E') && tile && !inTrash) (tile.kind === 'photo' ? useUi.getState().setEditorId(tile.id) : useUi.getState().setVideoEditorId(tile.id))
      else if (e.key === 'i' || e.key === 'I') toggleInfo()
      else if (e.key === 'f' || e.key === 'F') setFacesOn((v) => !v)
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
    <div className="animate-fade-in fixed inset-0 z-40 flex bg-stage text-white">
      <div className="relative flex min-w-0 flex-1 flex-col">
        <div className="drag absolute inset-x-0 top-0 z-10 flex h-[52px] items-center gap-2 bg-gradient-to-b from-black/60 to-transparent pr-4 pl-[84px]">
          <button onClick={closeViewer} className="no-drag flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] text-white/85 hover:bg-white/10">
            <ChevronLeft className="size-4" /> {t('Retour')}
          </button>
          <div className="min-w-0 flex-1 text-center">
            {when && (
              <>
                <div className="truncate text-[13px] font-bold">{when.date}</div>
                <div className="text-[11.5px] text-white/60">{when.time}</div>
              </>
            )}
          </div>
          <div className="no-drag flex items-center gap-0.5 [&_button]:text-white/80 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
            {!inTrash && (
              <IconButton label={t('Favori (.)')} onClick={toggleFavorite}>
                <Heart className={clsx('size-[18px]', tile?.favorite && 'fill-heart text-heart')} />
              </IconButton>
            )}
            {detail?.edited && !version && (
              <button
                onClick={() => {
                  const previous = detail.edit
                  void api(`/api/assets/${detail.id}/edit`, { method: 'PUT', json: { edit: null } }).then(() =>
                    useUi.getState().toast(t('Photo revenue à l’original'), { label: t('Annuler'), run: () => void api(`/api/assets/${detail.id}/edit`, { method: 'PUT', json: { edit: previous } }) })
                  )
                }}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-white/85 hover:bg-white/10"
                title={t('Annuler toutes les retouches de cette photo')}
              >
                <Undo2 className="size-4" /> {t('Revenir à l’original')}
              </button>
            )}
            {tile && !inTrash && (
              <button
                onClick={() => {
                  const target = version ? version.id : tile.id
                  if (tile.kind === 'photo') useUi.getState().setEditorId(target)
                  else useUi.getState().setVideoEditorId(tile.id)
                }}
                className="flex items-center gap-1.5 rounded-lg px-2.5 py-1.5 text-[12.5px] text-white/85 hover:bg-white/10"
                title={t('Modifier (E)')}
              >
                <SlidersHorizontal className="size-4" /> {t('Modifier')}
              </button>
            )}
            {tile && (
              <IconButton label={t('Exporter')} onClick={() => useUi.getState().setExportIds([tile.id])}>
                <Share className="size-[18px]" />
              </IconButton>
            )}
            {ml?.enabled && tile?.kind === 'photo' && (
              <>
                <IconButton label={t('Visages (f)')} onClick={() => setFacesOn((v) => !v)} active={facesOn}>
                  <ScanFace className="size-[18px]" />
                </IconButton>
                {ml.running.clip && (
                  <IconButton label={t('Photos semblables')} onClick={() => {
                    closeViewer()
                    useUi.getState().openSimilar(tile.id)
                  }}>
                    <Sparkles className="size-[18px]" />
                  </IconButton>
                )}
              </>
            )}
            <IconButton label={t('Informations (i)')} onClick={toggleInfo} active={infoOpen}>
              <Info className="size-[18px]" />
            </IconButton>
            {desktop && detail ? (
              <IconButton label={t('Afficher dans le dossier')} onClick={() => void desktop.reveal(detail.path)}>
                <FolderOpen className="size-[18px]" />
              </IconButton>
            ) : (
              tile && (
                <a href={media.download(tile.id)} className="grid size-8 place-items-center rounded-lg text-white/80 hover:bg-white/10 hover:text-white" title={t('Télécharger')}>
                  <Download className="size-[18px]" />
                </a>
              )
            )}
            <IconButton label={inTrash ? t('Restaurer') : t('Supprimer (⌫)')} onClick={trash}>
              {inTrash ? <RotateCcw className="size-[18px]" /> : <Trash2 className="size-[18px]" />}
            </IconButton>
          </div>
        </div>

        <div className="relative flex-1 overflow-hidden">
          {shownTile && <Stage key={shownTile.id} tile={shownTile} detail={shownDetail?.id === shownTile.id ? shownDetail : undefined} facesOn={facesOn && Boolean(ml?.enabled)} />}
          {detail && detail.versionList.length > 0 && (
            <div className="absolute bottom-20 left-1/2 z-10 flex -translate-x-1/2 items-center gap-1 rounded-pill bg-stage-panel p-1">
              <button onClick={() => setVersionId(null)} className={clsx('rounded-lg px-3 py-1.5 text-[12px]', !version ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white')}>
                {detail.edited ? t('Photo (retouchée)') : t('Original')}
              </button>
              {detail.versionList.map((v, k) => (
                <button key={v.id} onClick={() => setVersionId(v.id)} className={clsx('rounded-lg px-3 py-1.5 text-[12px]', version?.id === v.id ? 'bg-white/20 text-white' : 'text-white/70 hover:text-white')}>
                  {detail.versionList.length > 1 ? t('Copie modifiée {n}', { n: k + 1 }) : t('Copie modifiée')}
                </button>
              ))}
              {version && (
                <>
                  <div className="mx-1 h-4 w-px bg-white/20" />
                  <button
                    title={t('Faire de cette copie un élément séparé de la photothèque')}
                    className="grid size-7 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={() => void api(`/api/assets/${version.id}/detach`, { method: 'POST' }).then(() => setVersionId(null))}
                  >
                    <Unlink className="size-3.5" />
                  </button>
                  <button
                    title={t('Supprimer cette copie')}
                    className="grid size-7 place-items-center rounded-lg text-white/70 hover:bg-white/10 hover:text-white"
                    onClick={() => void trashWithUndo([version.id], false).then(() => setVersionId(null))}
                  >
                    <Trash2 className="size-3.5" />
                  </button>
                </>
              )}
            </div>
          )}
          {i > 0 && (
            <NavButton side="left" onClick={() => go(-1)} />
          )}
          {i < total - 1 && <NavButton side="right" onClick={() => go(1)} />}
        </div>
        <Filmstrip cache={cache} index={i} total={total} onSelect={openViewer} />
      </div>
      {infoOpen && (shownDetail ?? detail) && <InfoPanel detail={(shownDetail ?? detail)!} />}
    </div>
  )
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick(): void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      onClick={onClick}
      aria-label={side === 'left' ? t('Précédent') : t('Suivant')}
      className={clsx(
        'group absolute top-1/2 grid h-24 w-14 -translate-y-1/2 place-items-center opacity-0 transition-opacity hover:opacity-100',
        side === 'left' ? 'left-0' : 'right-0'
      )}
    >
      <span className="grid size-10 place-items-center rounded-full bg-stage-panel">
        <Icon className="size-5" />
      </span>
    </button>
  )
}

/** Photo or video area with fit-to-screen, double-click zoom, wheel/pinch zoom and drag panning. */
function Stage({ tile, detail, facesOn }: { tile: AssetTile; detail: AssetDetail | undefined; facesOn: boolean }) {
  const [loaded, setLoaded] = useState(false)
  const wrap = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ w: 0, h: 0 })
  useEffect(() => {
    const el = wrap.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setBox({ w: e!.contentRect.width, h: e!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const ratio = detail?.width && detail.height ? detail.width / detail.height : tile.ratio
  const imgRect = (() => {
    if (!box.w || !box.h) return null
    let w = box.w
    let h = w / ratio
    if (h > box.h) {
      h = box.h
      w = h * ratio
    }
    return { left: (box.w - w) / 2, top: (box.h - h) / 2, width: w, height: h }
  })()
  const fitted = imgRect ? { width: imgRect.width, height: imgRect.height } : undefined
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
            {t('Ce format vidéo ({ext}) sera lisible après conversion.', { ext: detail.ext.toUpperCase() })}
          </div>
        </div>
      )
    }
    return (
      <div className="absolute inset-x-6 top-14 bottom-6 flex items-center justify-center">
        <video key={tile.id} src={media.original(tile.id)} poster={media.thumb(tile.id, tile.v)} controls autoPlay playsInline className="max-h-full max-w-full rounded-sm bg-black shadow-2xl" />
      </div>
    )
  }

  return (
    <div
      className={clsx('absolute inset-0 overflow-hidden', scale > 1 ? 'cursor-grab active:cursor-grabbing' : 'cursor-default')}
      onWheel={onWheel}
      onDoubleClick={onDouble}
      onPointerDown={onDown}
      onPointerMove={onMove}
      onPointerUp={() => (drag.current = null)}
    >
      <div
        ref={wrap}
        // definite box (absolute, not a grid track) so the photo is sized to fit it instead of its natural size
        className="absolute inset-x-4 top-14 bottom-4 flex items-center justify-center transition-transform"
        style={{ transform: `scale(${scale}) translate(${pan.x}px, ${pan.y}px)` }}
      >
        {scale === 1 && loaded && <FacesOverlay assetId={tile.id} rect={imgRect} visible={facesOn} />}
        {!loaded && <img src={media.thumb(tile.id, tile.v)} alt="" draggable={false} className="absolute object-contain blur-[2px]" style={fitted ?? { maxWidth: '100%', maxHeight: '100%' }} />}
        <img
          src={media.preview(tile.id, tile.v)}
          alt=""
          draggable={false}
          onLoad={() => setLoaded(true)}
          style={fitted}
          className={clsx('max-h-full max-w-full object-contain transition-opacity duration-(--dh-motion-enter)', loaded ? 'opacity-100' : 'opacity-0')}
        />
        {liveOn && detail?.hasLiveVideo && (
          <video src={media.live(tile.id)} autoPlay muted playsInline onEnded={() => setLiveOn(false)} className="absolute max-h-full max-w-full object-contain" style={fitted} />
        )}
      </div>
      {tile.live && (
        <button
          onMouseEnter={() => setLiveOn(true)}
          onMouseLeave={() => setLiveOn(false)}
          onClick={() => setLiveOn(true)}
          className="absolute top-16 left-4 rounded-card bg-stage-panel px-2 py-1 text-[11px] font-bold tracking-wider text-white"
        >
          LIVE
        </button>
      )}
    </div>
  )
}
