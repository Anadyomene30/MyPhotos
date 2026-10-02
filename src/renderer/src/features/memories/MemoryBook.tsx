import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { BookOpen, Clapperboard, FolderHeart, Loader2, Pencil, Pin, RefreshCw, Sparkles, Trash2, Wand2, X } from 'lucide-react'
import { api, media } from '@/api/client'
import { memoriesApi, openAsset as openAssetInLibrary, useMemory } from '@/api/hooks'
import { Button, IconButton } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { promptText } from '@/components/Prompt'
import { useUi } from '@/store'
import { plural } from '@/lib/format'
import { t } from '@/i18n'
import type { AssetTile, MemoryDetail, MemoryPage } from '@shared/types'
import { justify } from '@shared/edit/justify'

/** Editorial pages of a memory: every page keeps a square-ish book format so PDF export matches the screen. */
function Page({ page, tiles, m, onOpen, printMode }: { page: MemoryPage; tiles: Map<number, AssetTile>; m: MemoryDetail; onOpen(id: number): void; printMode: boolean }) {
  /** Photo in a frame. Full-bleed frames crop around the focal point (faces, or the most detailed area). */
  const img = (id: number, cls = '', slotRatio = 1, fill = false): React.JSX.Element => {
    const tile = tiles.get(id)
    const r = tile?.ratio ?? 1.5
    const cover = fill || Math.abs(Math.log(r / slotRatio)) < 0.35
    return (
      <button onClick={() => onOpen(id)} className={clsx('block h-full w-full overflow-hidden', cls)} style={{ background: cover ? 'rgba(0,0,0,0.2)' : m.theme.bg }}>
        {tile && (
          <img
            src={media.preview(id, tile.v)}
            alt=""
            className={clsx('h-full w-full', cover ? 'object-cover' : 'object-contain')}
            style={{ objectPosition: `${tile.fx * 100}% ${tile.fy * 100}%` }}
            draggable={false}
            loading={printMode ? 'eager' : 'lazy'}
          />
        )}
      </button>
    )
  }
  const light = m.theme.onAccent === 'light'
  switch (page.type) {
    case 'cover':
      return (
        <div className="relative h-full w-full">
          {img(page.ids[0]!, '', 1, true)}
          <div className="pointer-events-none absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/10" />
          <div className="pointer-events-none absolute right-[8%] bottom-[9%] left-[8%] text-white">
            <div className="mb-3 h-1 w-14 rounded-full" style={{ background: m.theme.accent }} />
            <h1 className="font-display text-[clamp(28px,5vw,64px)] leading-[1.02] font-bold tracking-tight drop-shadow-md">{m.title}</h1>
            {m.subtitle && <p className="mt-2 text-[clamp(13px,1.6vw,20px)] text-white/85">{m.subtitle}</p>}
          </div>
        </div>
      )
    case 'title':
      return (
        <div className="flex h-full w-full flex-col items-center justify-center px-[12%] text-center" style={{ background: m.theme.accent, color: light ? '#fff' : '#111' }}>
          <p className="text-[clamp(11px,1.2vw,14px)] font-semibold tracking-[0.3em] uppercase opacity-70">{t('Souvenir')}</p>
          <h2 className="mt-4 font-display text-[clamp(24px,3.6vw,46px)] leading-tight font-bold">{page.text}</h2>
          {page.sub && <p className="mt-3 text-[clamp(13px,1.5vw,18px)] opacity-80">{page.sub}</p>}
        </div>
      )
    case 'hero':
    case 'duo':
    case 'trio':
    case 'grid': {
      // justified layout: every photo keeps its own proportions, nothing is cropped
      const ratios = page.ids.map((i) => tiles.get(i)?.ratio ?? 1.5)
      const rects = justify(ratios, { x: 0.06, y: 0.06, w: 0.88, h: 0.88 }, page.ids.length > 1 ? 0.022 : 0)
      return (
        <div className="relative h-full w-full" style={{ background: m.theme.bg }}>
          {page.ids.map((id, k) => {
            const r = rects[k]!
            return (
              <div key={id} className="absolute" style={{ left: `${r.x * 100}%`, top: `${r.y * 100}%`, width: `${r.w * 100}%`, height: `${r.h * 100}%` }}>
                {img(id, 'rounded-[3px] shadow-xl', ratios[k]!, true)}
              </div>
            )
          })}
        </div>
      )
    }
    case 'end':
      return (
        <div className="relative flex h-full w-full flex-col items-center justify-center gap-[4%] text-center" style={{ background: m.theme.accent, color: light ? '#fff' : '#111' }}>
          <div className="flex gap-[2%] px-[15%]">
            {page.ids.map((id) => <div key={id} className="aspect-square w-[22%] overflow-hidden rounded-full shadow-lg">{img(id, '', 1, true)}</div>)}
          </div>
          <p className="font-display text-[clamp(16px,2vw,26px)] font-semibold">{plural(m.count, 'photo', 'photos')} · MyPhotos</p>
        </div>
      )
  }
}

export function MemoryBook({ id, printMode = false }: { id: number; printMode?: boolean }) {
  const { data: m, isLoading } = useMemory(id)
  const qc = useQueryClient()
  const close = (): void => useUi.getState().openMemory(null)
  const [busy, setBusy] = useState<string | null>(null)
  const scroller = useRef<HTMLDivElement>(null)
  const tiles = useMemo(() => new Map((m?.tiles ?? []).map((t) => [t.id, t])), [m])
  const refresh = (): Promise<void> => qc.invalidateQueries({ queryKey: ['memory', id] }).then(() => qc.invalidateQueries({ queryKey: ['memories'] }))

  useEffect(() => {
    if (printMode) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [printMode])

  // signal readiness to the PDF printer once every image is loaded
  useEffect(() => {
    if (!printMode || !m) return
    const imgs = [...document.querySelectorAll('img')]
    let done = 0
    const mark = (): void => {
      done++
      if (done >= imgs.length) document.documentElement.dataset.printReady = '1'
    }
    if (!imgs.length) document.documentElement.dataset.printReady = '1'
    for (const i of imgs) {
      if (i.complete) mark()
      else {
        i.addEventListener('load', mark)
        i.addEventListener('error', mark)
      }
    }
  }, [printMode, m])

  if (isLoading || !m) {
    return (
      <div className="fixed inset-0 z-[55] grid place-items-center bg-stage">
        <Loader2 className="size-6 animate-spin text-white/40" />
      </div>
    )
  }

  const openAsset = (assetId: number): void => {
    if (printMode) return
    useUi.getState().openMemory(null)
    // closing the photo reopens the memory
    void openAssetInLibrary(assetId, () => {
      const ui = useUi.getState()
      ui.openPage('memories')
      ui.openMemory(id)
    })
  }

  const run = async (key: string, fn: () => Promise<unknown>, done?: string): Promise<void> => {
    setBusy(key)
    try {
      await fn()
      await refresh()
      if (done) useUi.getState().toast(done)
    } catch (e) {
      useUi.getState().toast((e as Error).message)
    } finally {
      setBusy(null)
    }
  }

  const pages = m.pages.map((p, i) => (
    <div key={i} className={clsx('page mx-auto aspect-square w-full max-w-[900px] overflow-hidden shadow-2xl', !printMode && 'rounded-md')} style={printMode ? { pageBreakAfter: 'always', breakAfter: 'page', width: '100vw', height: '100vh', maxWidth: 'none' } : undefined}>
      <Page page={p} tiles={tiles} m={m} onOpen={openAsset} printMode={printMode} />
    </div>
  ))

  if (printMode) return <div className="bg-black">{pages}</div>

  return (
    <div className="animate-fade-in fixed inset-0 z-[55] flex flex-col text-white" style={{ background: m.theme.bg }}>
      <div className="drag flex h-[52px] shrink-0 items-center gap-2 bg-black/30 pr-4 pl-[84px] backdrop-blur-xl">
        <button onClick={close} className="no-drag flex items-center gap-1 rounded-lg px-2 py-1 text-[13px] font-medium text-white/85 hover:bg-white/10"><X className="size-4" /> {t('Fermer')}</button>
        <div className="min-w-0 flex-1 truncate text-center text-[13px] font-semibold">{m.title}</div>
        <div className="no-drag flex items-center gap-1 [&_button]:text-white/80 [&_button:hover]:bg-white/10 [&_button:hover]:text-white">
          <IconButton label={t('Renommer')} onClick={() => void promptText({ title: t('Titre du souvenir'), initial: m.title, confirmLabel: t('Renommer') }).then((title) => { if (title) void run('rename', () => memoriesApi.update(m.id, { title })) })}>
            <Pencil className="size-[18px]" />
          </IconButton>
          <IconButton label={t('Titre suggéré par Claude (clé API requise)')} onClick={() => void run('enrich', () => memoriesApi.enrich(m.id), t('Titre mis à jour par Claude'))} disabled={busy === 'enrich'}>
            {busy === 'enrich' ? <Loader2 className="size-[18px] animate-spin" /> : <Wand2 className="size-[18px]" />}
          </IconButton>
          <IconButton label={t('Nouvelle sélection')} onClick={() => void run('regen', () => memoriesApi.regenerate(m.id), t('Sélection renouvelée'))}>
            <RefreshCw className="size-[18px]" />
          </IconButton>
          <IconButton label={m.pinned ? t('Désépingler') : t('Épingler')} active={m.pinned} onClick={() => void run('pin', () => memoriesApi.update(m.id, { pinned: !m.pinned }))}>
            <Pin className={clsx('size-[18px]', m.pinned && 'fill-white')} />
          </IconButton>
          <IconButton label={t('Ne plus proposer')} onClick={() => void confirm({ title: t('Retirer ce souvenir ?'), message: t('Il ne sera plus proposé. Vos photos ne sont pas touchées.'), confirmLabel: t('Retirer'), danger: true }).then((ok) => { if (ok) void run('dismiss', () => memoriesApi.update(m.id, { dismissed: true })).then(close) })}>
            <Trash2 className="size-[18px]" />
          </IconButton>
          <IconButton label={t('Créer une vidéo')} onClick={() => useUi.getState().openRetro({ source: { type: 'ids', value: m.assetIds }, title: m.title, subtitle: m.subtitle ?? undefined })}>
            <Clapperboard className="size-[18px]" />
          </IconButton>
          <div className="mx-1 h-5 w-px bg-white/20" />
          <Button variant="secondary" className="no-drag bg-white/12 text-white hover:bg-white/20" onClick={() => void run('album', () => memoriesApi.saveAlbum(m.id), t('Album créé à partir du souvenir'))}>
            <FolderHeart className="size-4" /> {m.albumId ? t('Album lié') : t('Enregistrer en album')}
          </Button>
          {window.desktop && (
            <Button variant="primary" className="no-drag" disabled={busy === 'pdf'} onClick={() => void run('pdf', async () => {
              const r = await api<{ file: string }>(`/api/memories/${m.id}/pdf`, { method: 'POST', json: { format: 'square' } })
              useUi.getState().toast(t('Livre photo PDF créé'), { label: t('Afficher'), run: () => void window.desktop?.reveal(r.file) })
            })}>
              {busy === 'pdf' ? <Loader2 className="size-4 animate-spin" /> : <BookOpen className="size-4" />} {t('Livre photo PDF')}
            </Button>
          )}
        </div>
      </div>
      <div ref={scroller} className="scroll-thin min-h-0 flex-1 space-y-6 overflow-y-auto px-6 py-6">
        {pages}
        <p className="pb-4 text-center text-[11.5px] text-white/40"><Sparkles className="mr-1 inline size-3" /> {t('Sélection automatique : cliquez sur une photo pour l’ouvrir, « Nouvelle sélection » pour en proposer une autre.')}</p>
      </div>
    </div>
  )
}
