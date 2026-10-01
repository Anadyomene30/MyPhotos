import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Clapperboard, Loader2, Music, Play, X } from 'lucide-react'
import { api, apiBase, token } from '@/api/client'
import { onServerEvent } from '@/api/client'
import { useYears } from '@/api/hooks'
import { Button, IconButton, Segmented } from '@/components/ui'
import { useUi } from '@/store'
import { count } from '@/lib/format'
import { t } from '@/i18n'
import type { RetroOptions } from '@shared/types'

const DURATIONS = [30, 60, 120, 180, 300]

export function RetroDialog() {
  const req = useUi((s) => s.retro)
  const close = (): void => useUi.getState().openRetro(null)
  const { data: years } = useYears()
  const [source, setSource] = useState<RetroOptions['source']>({ type: 'all' })
  const [seconds, setSeconds] = useState(60)
  const [pace, setPace] = useState<RetroOptions['pace']>('gentle')
  const [format, setFormat] = useState<RetroOptions['format']>('16:9')
  const [resolution, setResolution] = useState<RetroOptions['resolution']>(1080)
  const [music, setMusic] = useState<string>('')
  const [title, setTitle] = useState('')
  const [titleCards, setTitleCards] = useState(true)
  const [includeVideos, setIncludeVideos] = useState(true)
  const [busy, setBusy] = useState(false)
  const [preview, setPreview] = useState<string | null>(null)
  const [previewing, setPreviewing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!req) return
    setSource(req.source)
    setTitle(req.title ?? (req.source.type === 'year' ? t('{year} en images', { year: req.source.value }) : t('Nos souvenirs')))
    setPreview(null)
    setError(null)
  }, [req])

  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type !== 'retro-done' || !e.preview) return
        setPreviewing(false)
        if (e.ok && e.file) setPreview(`${apiBase}/api/retrospective/preview?t=${token}&file=${encodeURIComponent(e.file)}&v=${Date.now()}`)
        else setError(e.error ?? t('Aperçu impossible'))
      }),
    []
  )

  useEffect(() => {
    if (!req) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [req])

  if (!req) return null
  const opts = (p: boolean): RetroOptions => ({
    source, seconds, pace, format, resolution, music: music || null, title: title.trim() || null, subtitle: req.subtitle ?? null, titleCards, includeVideos, preview: p
  })
  const start = async (p: boolean): Promise<void> => {
    setError(null)
    if (p) {
      setPreviewing(true)
      setPreview(null)
    } else setBusy(true)
    try {
      await api('/api/retrospective', { method: 'POST', json: opts(p) })
      if (!p) {
        useUi.getState().toast(t('Vidéo en cours de création. Elle apparaîtra dans « MyPhotos Créations ».'))
        close()
      }
    } catch (e) {
      setError((e as Error).message)
      setPreviewing(false)
    } finally {
      setBusy(false)
    }
  }
  const sel = 'rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent'
  const sourceKey = source.type === 'year' ? `year:${source.value}` : source.type
  return (
    <div className="animate-fade-in fixed inset-0 z-[58] grid place-items-center bg-black/35 backdrop-blur-[2px]" onMouseDown={close}>
      <div className="animate-pop-in flex max-h-[92vh] w-[720px] max-w-[95vw] flex-col rounded-2xl border border-line bg-surface shadow-2xl dark:bg-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Clapperboard className="size-4 text-accent" />
          <h2 className="flex-1 font-display text-[16px] font-semibold">{t('Créer une vidéo souvenir')}</h2>
          <IconButton label={t('Fermer')} onClick={close}><X className="size-4" /></IconButton>
        </div>
        <div className="scroll-thin grid grid-cols-[1fr_260px] gap-5 overflow-y-auto p-5">
          <div className="space-y-4">
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t('Titre d’ouverture')}</span>
              <input value={title} onChange={(e) => setTitle(e.target.value)} className={clsx(sel, 'w-full')} placeholder={t('Nos souvenirs')} />
            </label>
            <label className="block">
              <span className="mb-1 block text-[12px] font-medium text-muted">{t('Photos')}</span>
              <select className={clsx(sel, 'w-full')} value={sourceKey} onChange={(e) => {
                const v = e.target.value
                if (v === 'all') setSource({ type: 'all' })
                else if (v.startsWith('year:')) {
                  const y = Number(v.slice(5))
                  setSource({ type: 'year', value: y })
                  setTitle(t('{year} en images', { year: y }))
                } else setSource(req.source)
              }}>
                {req.source.type !== 'all' && req.source.type !== 'year' && <option value={req.source.type}>{req.source.type === 'ids' ? t('La sélection ({n})', { n: count(req.source.value.length) }) : req.source.type === 'person' ? t('Cette personne') : t('Cet album')}</option>}
                <option value="all">{t('Toute la photothèque')}</option>
                {(years ?? []).map((y) => <option key={y.year} value={`year:${y.year}`}>{t('L’année {year} ({n})', { year: y.year, n: count(y.count) })}</option>)}
              </select>
            </label>
            <div>
              <span className="mb-1 block text-[12px] font-medium text-muted">{t('Durée')}</span>
              <Segmented size="sm" value={String(seconds)} onChange={(v) => setSeconds(Number(v))} options={DURATIONS.map((d) => ({ value: String(d), label: d < 60 ? t('{n} s', { n: d }) : t('{n} min', { n: d / 60 }) }))} />
            </div>
            <div className="flex flex-wrap gap-5">
              <div>
                <span className="mb-1 block text-[12px] font-medium text-muted">{t('Rythme')}</span>
                <Segmented<RetroOptions["pace"]> size="sm" value={pace} onChange={setPace} options={[{ value: 'gentle', label: t('Doux') }, { value: 'fast', label: t('Dynamique') }]} />
              </div>
              <div>
                <span className="mb-1 block text-[12px] font-medium text-muted">{t('Format')}</span>
                <Segmented<RetroOptions["format"]> size="sm" value={format} onChange={setFormat} options={[{ value: '16:9', label: t('Paysage') }, { value: '9:16', label: t('Vertical') }, { value: '1:1', label: t('Carré') }]} />
              </div>
              <div>
                <span className="mb-1 block text-[12px] font-medium text-muted">{t('Qualité')}</span>
                <Segmented size="sm" value={String(resolution)} onChange={(v) => setResolution(Number(v) as RetroOptions['resolution'])} options={[{ value: '720', label: '720p' }, { value: '1080', label: '1080p' }, { value: '2160', label: '4K' }]} />
              </div>
            </div>
            <div>
              <span className="mb-1 block text-[12px] font-medium text-muted">{t('Musique')}</span>
              <div className="flex gap-2">
                <input value={music} onChange={(e) => setMusic(e.target.value)} placeholder={t('Aucune (silence)')} className={clsx(sel, 'min-w-0 flex-1')} />
                {window.desktop && (
                  <Button onClick={() => void window.desktop!.pickFile('audio', { title: t('Choisir une musique'), filter: t('Musique') }).then((f) => f && setMusic(f))}>
                    <Music className="size-4" /> {t('Choisir…')}
                  </Button>
                )}
              </div>
              <p className="mt-1 text-[11.5px] text-faint">{t('Un fichier MP3, M4A, WAV ou FLAC de votre ordinateur. Il est bouclé ou coupé avec un fondu.')}</p>
            </div>
            <div className="space-y-1.5 text-[13px]">
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--accent)]" checked={titleCards} onChange={(e) => setTitleCards(e.target.checked)} /> {t('Afficher l’année à chaque changement d’année')}</label>
              <label className="flex items-center gap-2"><input type="checkbox" className="accent-[var(--accent)]" checked={includeVideos} onChange={(e) => setIncludeVideos(e.target.checked)} /> {t('Inclure de courts extraits de vidéos')}</label>
            </div>
            {error && <p className="text-[12.5px] text-red-500">{error}</p>}
          </div>
          <div className="space-y-2">
            <div className={clsx('tile-bg grid w-full place-items-center overflow-hidden rounded-xl', format === '9:16' ? 'aspect-[9/16]' : format === '1:1' ? 'aspect-square' : 'aspect-video')}>
              {preview ? (
                <video src={preview} controls autoPlay className="h-full w-full bg-black object-contain" />
              ) : previewing ? (
                <span className="flex items-center gap-2 text-[12px] text-muted"><Loader2 className="size-4 animate-spin" /> {t('Aperçu…')}</span>
              ) : (
                <Clapperboard className="size-8 text-faint" strokeWidth={1.4} />
              )}
            </div>
            <Button className="w-full" disabled={previewing} onClick={() => void start(true)}>
              <Play className="size-4" /> {t('Aperçu rapide')}
            </Button>
            <p className="text-[11.5px] leading-relaxed text-faint">{t('Les meilleures photos sont choisies automatiquement, réparties dans le temps, sans doublons, avec un mouvement lent vers les visages.')}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={close}>{t('Annuler')}</Button>
          <Button variant="primary" disabled={busy} onClick={() => void start(false)}>
            {busy && <Loader2 className="size-4 animate-spin" />} {t('Créer la vidéo')}
          </Button>
        </div>
      </div>
    </div>
  )
}
