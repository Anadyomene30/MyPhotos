import { useEffect, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import clsx from 'clsx'
import { FlipHorizontal2, Pause, Play, RotateCcwSquare, Volume2, VolumeX } from 'lucide-react'
import { api, media } from '@/api/client'
import { useAsset } from '@/api/hooks'
import { Button } from '@/components/ui'
import { useUi } from '@/store'
import { t } from '@/i18n'
import { duration as fmtDuration } from '@/lib/format'
import { cssPreviewFilter, NEUTRAL_VIDEO, type VideoEdit } from '@shared/edit/video'
import { Slider } from './Slider'

type Tab = 'color' | 'image' | 'speed' | 'output'

export function VideoEditor() {
  const id = useUi((s) => s.videoEditorId)
  if (id === null) return null
  return <VideoEditorInner key={id} id={id} />
}

const CROPS: Array<{ label: string; ratio: number | null }> = [
  { label: t('Original'), ratio: null },
  { label: '16:9', ratio: 16 / 9 },
  { label: '1:1', ratio: 1 },
  { label: '4:5', ratio: 4 / 5 },
  { label: '9:16', ratio: 9 / 16 }
]

function Filmstrip({ src, duration, count = 14 }: { src: string; duration: number; count?: number }) {
  const [frames, setFrames] = useState<string[]>([])
  useEffect(() => {
    if (!duration) return
    let cancelled = false
    const v = document.createElement('video')
    v.crossOrigin = 'anonymous'
    v.muted = true
    v.preload = 'auto'
    v.src = src
    const canvas = document.createElement('canvas')
    const out: string[] = []
    const grab = (i: number): void => {
      if (cancelled || i >= count) return
      v.currentTime = Math.min(duration - 0.05, ((i + 0.5) / count) * duration)
      v.onseeked = () => {
        const h = 56
        canvas.width = Math.round((v.videoWidth / v.videoHeight) * h) || 100
        canvas.height = h
        canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
        out.push(canvas.toDataURL('image/jpeg', 0.7))
        if (!cancelled) setFrames([...out])
        grab(i + 1)
      }
    }
    v.onloadeddata = () => grab(0)
    return () => {
      cancelled = true
      v.removeAttribute('src')
    }
  }, [src, duration, count])
  return (
    <div className="absolute inset-0 flex overflow-hidden rounded-lg">
      {frames.map((f, i) => (
        <img key={i} src={f} alt="" className="h-full min-w-0 flex-1 object-cover" draggable={false} />
      ))}
    </div>
  )
}

function VideoEditorInner({ id }: { id: number }) {
  const close = (): void => useUi.getState().setVideoEditorId(null)
  const { data: detail } = useAsset(id)
  const [e, setE] = useState<VideoEdit>({ ...NEUTRAL_VIDEO })
  const [tab, setTab] = useState<Tab>('color')
  const [playing, setPlaying] = useState(false)
  const [time, setTime] = useState(0)
  const [busy, setBusy] = useState(false)
  const video = useRef<HTMLVideoElement>(null)
  const bar = useRef<HTMLDivElement>(null)
  const dur = detail?.duration ?? 0
  const end = e.trim.end ?? dur

  useEffect(() => {
    const onKey = (ev: KeyboardEvent): void => {
      if (ev.key === 'Escape') close()
      else if (ev.key === ' ') {
        ev.preventDefault()
        toggle()
      } else return
      ev.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  })

  useEffect(() => {
    const v = video.current
    if (!v) return
    v.playbackRate = e.speed
    v.volume = Math.min(1, e.audio.volume)
    v.muted = e.audio.mute
  }, [e.speed, e.audio])

  const onTime = (): void => {
    const v = video.current
    if (!v) return
    setTime(v.currentTime)
    if (v.currentTime >= end - 0.03 || v.currentTime < e.trim.start - 0.2) {
      v.currentTime = e.trim.start
      if (v.currentTime >= end) v.pause()
    }
  }

  const toggle = (): void => {
    const v = video.current
    if (!v) return
    if (v.paused) {
      if (v.currentTime < e.trim.start || v.currentTime >= end - 0.05) v.currentTime = e.trim.start
      void v.play()
    } else v.pause()
  }

  const drag = useRef<'start' | 'end' | 'head' | null>(null)
  const onBarDown = (which: 'start' | 'end' | 'head') => (ev: RPointerEvent) => {
    ev.stopPropagation()
    drag.current = which
    ;(ev.target as HTMLElement).setPointerCapture(ev.pointerId)
    onBarMove(ev)
  }
  const onBarMove = (ev: RPointerEvent): void => {
    const which = drag.current
    const el = bar.current
    if (!which || !el || !dur) return
    const r = el.getBoundingClientRect()
    const t = Math.max(0, Math.min(dur, ((ev.clientX - r.left) / r.width) * dur))
    const v = video.current
    if (which === 'start') {
      const s = Math.min(t, end - 0.5)
      setE((x) => ({ ...x, trim: { ...x.trim, start: Math.max(0, s) } }))
      if (v) v.currentTime = Math.max(0, s)
    } else if (which === 'end') {
      const en = Math.max(t, e.trim.start + 0.5)
      setE((x) => ({ ...x, trim: { ...x.trim, end: en >= dur - 0.05 ? null : en } }))
      if (v) v.currentTime = en
    } else if (v) v.currentTime = Math.max(e.trim.start, Math.min(end, t))
  }

  const setColor = (k: keyof VideoEdit['color'], v: number | boolean): void => setE((x) => ({ ...x, color: { ...x.color, [k]: v } }))

  const cropFor = (ratio: number | null): VideoEdit['crop'] => {
    if (!ratio || !detail?.width || !detail.height) return null
    const rotated = e.rotate % 2 === 1
    const w = rotated ? detail.height : detail.width
    const h = rotated ? detail.width : detail.height
    let cw = w
    let ch = w / ratio
    if (ch > h) {
      ch = h
      cw = h * ratio
    }
    return { x: (1 - cw / w) / 2, y: (1 - ch / h) / 2, w: cw / w, h: ch / h }
  }

  const render = async (): Promise<void> => {
    setBusy(true)
    try {
      await api(`/api/video-edit/${id}`, { method: 'POST', json: { edit: e } })
      useUi.getState().toast(t('Montage en cours, la vidéo modifiée apparaîtra dans « MyPhotos Créations »'))
      close()
    } catch (err) {
      useUi.getState().toast((err as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const transform = `rotate(${e.rotate * 90}deg) scaleX(${e.flipH ? -1 : 1})`
  const outDur = (end - e.trim.start) / e.speed
  const pct = (t: number): string => `${dur ? (t / dur) * 100 : 0}%`

  return (
    <div className="animate-fade-in fixed inset-0 z-[55] flex flex-col bg-stage text-white select-none">
      <div className="drag flex h-[52px] shrink-0 items-center gap-2 pr-4 pl-[84px]">
        <Button variant="ghost" className="no-drag text-white/80 hover:bg-white/10 hover:text-white" onClick={close}>{t('Annuler')}</Button>
        <div className="flex-1 truncate text-center text-[13px] font-semibold">{detail?.name}</div>
        <span className="text-[12px] text-white/50">{t('Durée finale {d}', { d: fmtDuration(outDur) })}</span>
        <Button variant="primary" className="no-drag" disabled={busy || !detail} onClick={() => void render()}>{t('Créer la vidéo')}</Button>
      </div>
      <div className="flex min-h-0 flex-1">
        <div className="flex min-w-0 flex-1 flex-col gap-3 p-4 pt-0">
          <div className="relative grid min-h-0 flex-1 place-items-center overflow-hidden">
            <video
              ref={video}
              src={media.original(id)}
              className="max-h-full max-w-full transition-[filter,transform] duration-150"
              style={{ filter: cssPreviewFilter(e), transform }}
              onTimeUpdate={onTime}
              onPlay={() => setPlaying(true)}
              onPause={() => setPlaying(false)}
              onClick={toggle}
              playsInline
            />
            {e.crop && (
              <div className="pointer-events-none absolute inset-0 grid place-items-center">
                <div className="border-2 border-white/80 shadow-[0_0_0_9999px_rgba(0,0,0,0.55)]" style={{ aspectRatio: `${e.crop.w * (detail?.width ?? 16)} / ${e.crop.h * (detail?.height ?? 9)}`, height: '70%' }} />
              </div>
            )}
          </div>
          <div className="flex items-center gap-3">
            <button onClick={toggle} className="grid size-9 place-items-center rounded-full bg-white/10 hover:bg-white/20" aria-label={playing ? t('Pause') : t('Lecture')}>
              {playing ? <Pause className="size-4" /> : <Play className="size-4 fill-white" />}
            </button>
            <div ref={bar} className="relative h-14 flex-1 cursor-pointer" onPointerDown={onBarDown('head')} onPointerMove={onBarMove} onPointerUp={() => (drag.current = null)}>
              {dur > 0 && <Filmstrip src={media.original(id)} duration={dur} />}
              <div className="absolute inset-y-0 left-0 bg-black/65" style={{ width: pct(e.trim.start) }} />
              <div className="absolute inset-y-0 right-0 bg-black/65" style={{ left: pct(end) }} />
              <div className="absolute inset-y-0 rounded-lg border-[3px] border-amber-400" style={{ left: pct(e.trim.start), right: `calc(100% - ${pct(end)})` }}>
                <div className="absolute inset-y-0 -left-[3px] w-3 cursor-ew-resize rounded-l-md bg-amber-400" onPointerDown={onBarDown('start')} />
                <div className="absolute inset-y-0 -right-[3px] w-3 cursor-ew-resize rounded-r-md bg-amber-400" onPointerDown={onBarDown('end')} />
              </div>
              <div className="pointer-events-none absolute -inset-y-1 w-0.5 rounded bg-white shadow" style={{ left: pct(time) }} />
            </div>
            <span className="w-24 text-right text-[12px] text-white/60 tabular-nums">{fmtDuration(e.trim.start)} – {fmtDuration(end)}</span>
          </div>
        </div>
        <aside className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-l border-white/10 bg-stage-panel px-4 pb-6">
          <div className="sticky top-0 z-10 -mx-4 mb-3 bg-stage-panel px-4 pt-1 pb-3">
            <div className="grid grid-cols-4 rounded-[9px] bg-white/8 p-[3px]">
              {(['color', 'image', 'speed', 'output'] as Tab[]).map((k) => (
                <button key={k} onClick={() => setTab(k)} className={clsx('rounded-[7px] py-1 text-[12px] font-medium', tab === k ? 'bg-white/16 text-white' : 'text-white/60 hover:text-white')}>
                  {k === 'color' ? t('Couleur') : k === 'image' ? t('Image') : k === 'speed' ? t('Vitesse') : t('Sortie')}
                </button>
              ))}
            </div>
          </div>
          {tab === 'color' && (
            <div className="space-y-0.5">
              <Slider label={t('Exposition')} value={e.color.exposure} min={-2} max={2} step={0.05} onChange={(v) => setColor('exposure', v)} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} IL`} />
              <Slider label={t('Contraste')} value={e.color.contrast} onChange={(v) => setColor('contrast', v)} />
              <Slider label={t('Saturation')} value={e.color.saturation} onChange={(v) => setColor('saturation', v)} />
              <Slider label={t('Vibrance')} value={e.color.vibrance} onChange={(v) => setColor('vibrance', v)} />
              <Slider label={t('Température')} value={e.color.temperature} onChange={(v) => setColor('temperature', v)} />
              <label className="flex items-center gap-2 pt-2 text-[12.5px] text-white/80">
                <input type="checkbox" className="accent-[var(--accent)]" checked={e.color.mono} onChange={(ev) => setColor('mono', ev.target.checked)} /> {t('Noir et blanc')}
              </label>
              <p className="pt-3 text-[11.5px] text-white/40">{t('L’aperçu est approché ; le rendu final applique les réglages image par image.')}</p>
            </div>
          )}
          {tab === 'image' && (
            <div className="space-y-5">
              <div className="flex gap-2">
                <Button className="flex-1 bg-white/10 text-white hover:bg-white/16" onClick={() => setE((x) => ({ ...x, rotate: ((x.rotate + 3) % 4) as 0 | 1 | 2 | 3, crop: null }))}>
                  <RotateCcwSquare className="size-4" /> {t('Pivoter')}
                </Button>
                <Button className="flex-1 bg-white/10 text-white hover:bg-white/16" onClick={() => setE((x) => ({ ...x, flipH: !x.flipH }))}>
                  <FlipHorizontal2 className="size-4" /> {t('Miroir')}
                </Button>
              </div>
              <section>
                <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-white/45 uppercase">{t('Proportions')}</h3>
                <div className="grid grid-cols-5 gap-1.5">
                  {CROPS.map((c) => (
                    <button key={c.label} onClick={() => setE((x) => ({ ...x, crop: cropFor(c.ratio) }))} className="rounded-md bg-white/8 py-1.5 text-[11px] text-white/80 hover:bg-white/16">{c.label}</button>
                  ))}
                </div>
              </section>
              <label className="flex items-center justify-between rounded-lg bg-white/6 px-3 py-2.5 text-[12.5px]">
                <span>
                  {t('Stabilisation')}
                  <span className="block text-[11px] text-white/45">{t('Réduit les tremblements (recadre légèrement)')}</span>
                </span>
                <input type="checkbox" className="accent-[var(--accent)]" checked={e.stabilize} onChange={(ev) => setE((x) => ({ ...x, stabilize: ev.target.checked }))} />
              </label>
              <Slider label={t('Netteté')} value={e.detail.sharpness} min={0} onChange={(v) => setE((x) => ({ ...x, detail: { ...x.detail, sharpness: v } }))} />
              <Slider label={t('Réduction du bruit')} value={e.detail.denoise} min={0} onChange={(v) => setE((x) => ({ ...x, detail: { ...x.detail, denoise: v } }))} />
            </div>
          )}
          {tab === 'speed' && (
            <div className="space-y-5">
              <section>
                <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-white/45 uppercase">{t('Vitesse')}</h3>
                <div className="grid grid-cols-4 gap-1.5">
                  {[0.25, 0.5, 1, 1.5, 2, 4, 8, 16].map((s) => (
                    <button key={s} onClick={() => setE((x) => ({ ...x, speed: s }))} className={clsx('rounded-md py-1.5 text-[12px]', e.speed === s ? 'bg-accent text-on-accent' : 'bg-white/8 text-white/80 hover:bg-white/16')}>
                      {`${s}×`}
                    </button>
                  ))}
                </div>
              </section>
              <section className="space-y-2">
                <h3 className="text-[11px] font-semibold tracking-wide text-white/45 uppercase">{t('Son')}</h3>
                <Button className="w-full bg-white/10 text-white hover:bg-white/16" onClick={() => setE((x) => ({ ...x, audio: { ...x.audio, mute: !x.audio.mute } }))}>
                  {e.audio.mute ? <VolumeX className="size-4" /> : <Volume2 className="size-4" />} {e.audio.mute ? t('Son coupé') : t('Son activé')}
                </Button>
                {!e.audio.mute && (
                  <Slider label={t('Volume')} value={Math.round(e.audio.volume * 100)} min={0} max={200} onChange={(v) => setE((x) => ({ ...x, audio: { ...x.audio, volume: v / 100 } }))} format={(v) => `${v} %`} />
                )}
              </section>
            </div>
          )}
          {tab === 'output' && (
            <div className="space-y-4 text-[12.5px]">
              <label className="block">
                <span className="mb-1 block text-white/55">{t('Format')}</span>
                <select className="w-full rounded-lg border border-white/10 bg-white/6 px-2.5 py-1.5" value={e.output.format} onChange={(ev) => setE((x) => ({ ...x, output: { ...x.output, format: ev.target.value as VideoEdit['output']['format'] } }))}>
                  <option value="mp4-h264">{t('MP4 · H.264 (compatible partout)')}</option>
                  <option value="mp4-hevc">{t('MP4 · HEVC (plus léger)')}</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-white/55">{t('Résolution')}</span>
                <select className="w-full rounded-lg border border-white/10 bg-white/6 px-2.5 py-1.5" value={e.output.maxHeight ?? 0} onChange={(ev) => setE((x) => ({ ...x, output: { ...x.output, maxHeight: Number(ev.target.value) || null } }))}>
                  <option value={0}>{t('Originale')}</option>
                  <option value={2160}>4K</option>
                  <option value={1080}>1080p</option>
                  <option value={720}>720p</option>
                </select>
              </label>
              <label className="block">
                <span className="mb-1 block text-white/55">{t('Qualité')}</span>
                <select className="w-full rounded-lg border border-white/10 bg-white/6 px-2.5 py-1.5" value={e.output.quality} onChange={(ev) => setE((x) => ({ ...x, output: { ...x.output, quality: ev.target.value as VideoEdit['output']['quality'] } }))}>
                  <option value="high">{t('Haute')}</option>
                  <option value="medium">{t('Équilibrée')}</option>
                  <option value="small">{t('Légère')}</option>
                </select>
              </label>
              <p className="text-[11.5px] leading-relaxed text-white/45">{t('La vidéo d’origine n’est pas modifiée : une nouvelle vidéo est créée dans « MyPhotos Créations ».')}</p>
            </div>
          )}
        </aside>
      </div>
    </div>
  )
}
