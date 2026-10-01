import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as RPointerEvent } from 'react'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { FlipHorizontal2, Loader2, RotateCcw, RotateCcwSquare, Sparkles, Wand2 } from 'lucide-react'
import { api, media } from '@/api/client'
import { useAsset } from '@/api/hooks'
import { Button } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { useUi } from '@/store'
import { t } from '@/i18n'
import { autoEnhance, planGeometry } from '@shared/edit/pipeline'
import { cloneEdit, FILTERS, isNeutral, NEUTRAL, normalizeEdit, type PhotoEdit } from '@shared/edit/types'
import { drawGeometry, PreviewRenderer } from './renderer'
import { Slider } from './Slider'

type Tab = 'adjust' | 'filters' | 'crop'
const DISPLAY_MAX = 1600

export function Editor() {
  const id = useUi((s) => s.editorId)
  if (id === null) return null
  return <EditorInner key={id} id={id} />
}

function loadImage(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => resolve(img)
    img.onerror = () => reject(new Error(t('Impossible de charger l’image')))
    img.src = url
  })
}

function toCanvas(img: HTMLImageElement, max: number): HTMLCanvasElement {
  const k = Math.min(1, max / Math.max(img.naturalWidth, img.naturalHeight))
  const c = document.createElement('canvas')
  c.width = Math.max(1, Math.round(img.naturalWidth * k))
  c.height = Math.max(1, Math.round(img.naturalHeight * k))
  const ctx = c.getContext('2d', { willReadFrequently: true })!
  ctx.imageSmoothingQuality = 'high'
  ctx.drawImage(img, 0, 0, c.width, c.height)
  return c
}

function EditorInner({ id }: { id: number }) {
  const close = (): void => useUi.getState().setEditorId(null)
  const qc = useQueryClient()
  const { data: detail } = useAsset(id)
  const [edit, setEdit] = useState<PhotoEdit | null>(null)
  const initial = useRef<string>('')
  const [source, setSource] = useState<HTMLCanvasElement | null>(null)
  const [tab, setTab] = useState<Tab>('adjust')
  const [compare, setCompare] = useState(false)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const display = useRef<HTMLCanvasElement>(null)
  const stage = useRef<HTMLDivElement>(null)
  const [stageSize, setStageSize] = useState({ w: 800, h: 600 })
  const [imgSize, setImgSize] = useState({ w: 1, h: 1 })
  const renderer = useMemo(() => new PreviewRenderer(), [])
  useEffect(() => () => renderer.dispose(), [renderer])

  useEffect(() => {
    if (detail && !edit) {
      const e = normalizeEdit(detail.edit)
      setEdit(e)
      initial.current = JSON.stringify(e)
    }
  }, [detail, edit])

  useEffect(() => {
    loadImage(media.source(id)).then((img) => setSource(toCanvas(img, DISPLAY_MAX)), (e: Error) => setError(e.message))
  }, [id])

  useLayoutEffect(() => {
    const el = stage.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setStageSize({ w: e!.contentRect.width, h: e!.contentRect.height }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const cropping = tab === 'crop'
  const geomKey = edit ? JSON.stringify(edit.geometry) + (cropping ? ':c' : '') : ''
  const geomCanvas = useMemo(() => (source && edit ? drawGeometry(source, source.width, source.height, edit.geometry, !cropping) : null), [source, geomKey]) // eslint-disable-line react-hooks/exhaustive-deps

  const toneKey = edit ? JSON.stringify({ ...edit, geometry: null }) : ''
  useEffect(() => {
    const c = display.current
    if (!c || !geomCanvas || !edit) return
    if (compare) {
      c.width = source!.width
      c.height = source!.height
      c.getContext('2d')!.drawImage(source!, 0, 0)
      setImgSize({ w: c.width, h: c.height })
      return
    }
    renderer.render(geomCanvas, edit, (img) => {
      c.width = img.width
      c.height = img.height
      c.getContext('2d')!.putImageData(img, 0, 0)
      setImgSize({ w: img.width, h: img.height })
    })
  }, [geomCanvas, toneKey, compare, renderer]) // eslint-disable-line react-hooks/exhaustive-deps

  const dirty = edit ? JSON.stringify(edit) !== initial.current : false
  const cancel = useCallback(async () => {
    if (dirty && !(await confirm({ title: t('Abandonner les modifications ?'), message: t('Les réglages non enregistrés seront perdus.'), confirmLabel: t('Abandonner'), danger: true }))) return
    close()
  }, [dirty])

  const save = useCallback(async () => {
    if (!edit) return
    setSaving(true)
    try {
      await api(`/api/assets/${id}/edit`, { method: 'PUT', json: { edit: isNeutral(edit) ? null : edit } })
      await qc.invalidateQueries({ queryKey: ['asset', id] })
      useUi.getState().toast(t('Modifications enregistrées. L’original reste intact.'))
      close()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [edit, id, qc])

  const saveCopy = useCallback(async () => {
    if (!edit || isNeutral(edit)) return
    setSaving(true)
    try {
      await api(`/api/assets/${id}/edited-copy`, { method: 'POST', json: { edit } })
      useUi.getState().toast(t('Copie en cours d’enregistrement. Elle sera empilée avec l’original.'))
      close()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setSaving(false)
    }
  }, [edit, id])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.target as HTMLElement).closest('input[type=text], textarea')) return
      if (e.key === 'Escape') void cancel()
      else if (e.key === 'Enter' || ((e.metaKey || e.ctrlKey) && e.key === 's')) void save()
      else if (e.key === 'm' || e.key === 'M') setCompare(true)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    const onUp = (e: KeyboardEvent): void => {
      if (e.key === 'm' || e.key === 'M') setCompare(false)
    }
    window.addEventListener('keydown', onKey, true)
    window.addEventListener('keyup', onUp, true)
    return () => {
      window.removeEventListener('keydown', onKey, true)
      window.removeEventListener('keyup', onUp, true)
    }
  }, [cancel, save])

  const set = <K extends 'light' | 'color' | 'detail' | 'effects'>(group: K, key: keyof PhotoEdit[K], value: number | boolean): void => {
    setEdit((e) => (e ? { ...e, [group]: { ...e[group], [key]: value }, filter: group === 'detail' ? e.filter : null } : e))
  }

  const auto = (): void => {
    if (!source || !edit) return
    const d = source.getContext('2d', { willReadFrequently: true })!.getImageData(0, 0, source.width, source.height)
    const a = autoEnhance(d.data, source.width, source.height, 4)
    const { vibrance, ...light } = a
    setEdit({ ...edit, light: { ...edit.light, ...light }, color: { ...edit.color, vibrance } })
  }

  const fit = (() => {
    const k = Math.min(stageSize.w / imgSize.w, stageSize.h / imgSize.h, 2)
    return { w: Math.max(1, imgSize.w * k), h: Math.max(1, imgSize.h * k) }
  })()

  return (
    <div className="animate-fade-in fixed inset-0 z-[55] flex flex-col bg-[#0b0b0c] text-white select-none">
      <div className="drag flex h-[52px] shrink-0 items-center gap-2 pr-4 pl-[84px]">
        <Button variant="ghost" className="no-drag text-white/80 hover:bg-white/10 hover:text-white" onClick={() => void cancel()}>
          {t('Annuler')}
        </Button>
        <div className="flex-1 truncate text-center text-[13px] font-semibold">{detail?.name}</div>
        <button
          className="no-drag rounded-lg px-3 py-1.5 text-[12.5px] font-medium text-white/80 hover:bg-white/10"
          onPointerDown={() => setCompare(true)}
          onPointerUp={() => setCompare(false)}
          onPointerLeave={() => setCompare(false)}
          title={t('Maintenir pour voir l’original (touche M)')}
        >
          {t('Avant / après')}
        </button>
        <Button
          variant="ghost"
          className="no-drag text-white/80 hover:bg-white/10 hover:text-white"
          disabled={!edit || isNeutral(edit)}
          onClick={() => setEdit(cloneEdit(NEUTRAL))}
          title={t('Revenir à l’original')}
        >
          <RotateCcw className="size-3.5" /> {t('Original')}
        </Button>
        <Button
          variant="secondary"
          className="no-drag bg-white/10 text-white hover:bg-white/16"
          disabled={saving || !edit || isNeutral(edit)}
          onClick={() => void saveCopy()}
          title={t('Créer un nouveau fichier avec ces retouches, empilé sous l’original')}
        >
          {t('Enregistrer une copie')}
        </Button>
        <Button variant="primary" className="no-drag" disabled={saving || !edit} onClick={() => void save()} title={t('Appliquer à la photo (réversible à tout moment)')}>
          {saving && <Loader2 className="size-3.5 animate-spin" />} {t('Terminé')}
        </Button>
      </div>

      <div className="flex min-h-0 flex-1">
        <div ref={stage} className="relative m-4 mt-0 grid min-w-0 flex-1 place-items-center">
          {!source && !error && <Loader2 className="size-6 animate-spin text-white/40" />}
          {error && <p className="text-[13px] text-red-400">{error}</p>}
          <div className="relative" style={{ width: fit.w, height: fit.h, display: source ? 'block' : 'none' }}>
            <canvas ref={display} className="h-full w-full" />
            {cropping && edit && !compare && <CropOverlay edit={edit} onChange={setEdit} imgW={imgSize.w} imgH={imgSize.h} />}
            {compare && <span className="absolute top-3 left-3 rounded-full bg-black/60 px-2.5 py-1 text-[11.5px] font-semibold">{t('Original')}</span>}
          </div>
        </div>

        <aside className="scroll-thin w-[300px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#141416] px-4 pb-6">
          <div className="sticky top-0 z-10 -mx-4 mb-3 bg-[#141416] px-4 pt-1 pb-3">
            <div className="flex rounded-[9px] bg-white/8 p-[3px]">
              {(['adjust', 'filters', 'crop'] as Tab[]).map((k) => (
                <button key={k} onClick={() => setTab(k)} className={clsx('flex-1 rounded-[7px] py-1 text-[12.5px] font-medium', tab === k ? 'bg-white/16 text-white' : 'text-white/60 hover:text-white')}>
                  {k === 'adjust' ? t('Ajuster') : k === 'filters' ? t('Filtres') : t('Recadrer')}
                </button>
              ))}
            </div>
          </div>
          {edit && tab === 'adjust' && (
            <div className="space-y-5">
              <Button variant="secondary" className="w-full bg-white/10 text-white hover:bg-white/16" onClick={auto}>
                <Wand2 className="size-4" /> {t('Amélioration automatique')}
              </Button>
              <Group title={t('Lumière')}>
                <Slider label={t('Exposition')} value={edit.light.exposure} min={-3} max={3} step={0.05} onChange={(v) => set('light', 'exposure', v)} format={(v) => `${v > 0 ? '+' : ''}${v.toFixed(2)} IL`} />
                <Slider label={t('Éclat')} value={edit.light.brilliance} onChange={(v) => set('light', 'brilliance', v)} />
                <Slider label={t('Hautes lumières')} value={edit.light.highlights} onChange={(v) => set('light', 'highlights', v)} />
                <Slider label={t('Ombres')} value={edit.light.shadows} onChange={(v) => set('light', 'shadows', v)} />
                <Slider label={t('Contraste')} value={edit.light.contrast} onChange={(v) => set('light', 'contrast', v)} />
                <Slider label={t('Blancs')} value={edit.light.whites} onChange={(v) => set('light', 'whites', v)} />
                <Slider label={t('Noirs')} value={edit.light.blacks} onChange={(v) => set('light', 'blacks', v)} />
              </Group>
              <Group title={t('Couleur')}>
                <Slider label={t('Température')} value={edit.color.temperature} onChange={(v) => set('color', 'temperature', v)} />
                <Slider label={t('Teinte')} value={edit.color.tint} onChange={(v) => set('color', 'tint', v)} />
                <Slider label={t('Vibrance')} value={edit.color.vibrance} onChange={(v) => set('color', 'vibrance', v)} />
                <Slider label={t('Saturation')} value={edit.color.saturation} onChange={(v) => set('color', 'saturation', v)} />
                <label className="flex items-center gap-2 pt-1 text-[12.5px] text-white/80">
                  <input type="checkbox" className="accent-[var(--accent)]" checked={edit.color.mono} onChange={(e) => set('color', 'mono', e.target.checked)} />
                  {t('Noir et blanc')}
                </label>
              </Group>
              <Group title={t('Détails')}>
                <Slider label={t('Netteté')} value={edit.detail.sharpness} min={0} onChange={(v) => set('detail', 'sharpness', v)} />
                <Slider label={t('Clarté')} value={edit.detail.clarity} onChange={(v) => set('detail', 'clarity', v)} />
                <Slider label={t('Réduction du bruit')} value={edit.detail.noise} min={0} onChange={(v) => set('detail', 'noise', v)} />
              </Group>
              <Group title={t('Effets')}>
                <Slider label={t('Vignettage')} value={edit.effects.vignette} onChange={(v) => set('effects', 'vignette', v)} />
                <Slider label={t('Grain')} value={edit.effects.grain} min={0} onChange={(v) => set('effects', 'grain', v)} />
                <Slider label={t('Délavé')} value={edit.effects.fade} min={0} onChange={(v) => set('effects', 'fade', v)} />
              </Group>
            </div>
          )}
          {edit && tab === 'filters' && source && <FilterGrid source={source} edit={edit} onPick={setEdit} />}
          {edit && tab === 'crop' && <CropPanel edit={edit} onChange={setEdit} srcW={source?.width ?? 1} srcH={source?.height ?? 1} />}
        </aside>
      </div>
    </div>
  )
}

function Group({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section>
      <h3 className="mb-1.5 text-[11px] font-semibold tracking-wide text-white/45 uppercase">{title}</h3>
      <div className="space-y-0.5">{children}</div>
    </section>
  )
}

function FilterGrid({ source, edit, onPick }: { source: HTMLCanvasElement; edit: PhotoEdit; onPick(e: PhotoEdit): void }) {
  const [thumbs, setThumbs] = useState<Record<string, string>>({})
  useEffect(() => {
    let cancelled = false
    const r = new PreviewRenderer()
    const small = document.createElement('canvas')
    const k = 180 / Math.max(source.width, source.height)
    small.width = Math.round(source.width * k)
    small.height = Math.round(source.height * k)
    small.getContext('2d')!.drawImage(source, 0, 0, small.width, small.height)
    const queue = [...FILTERS]
    const next = (): void => {
      const f = queue.shift()
      if (!f || cancelled) return r.dispose()
      const copy = document.createElement('canvas')
      copy.width = small.width
      copy.height = small.height
      copy.getContext('2d')!.drawImage(small, 0, 0)
      r.render(copy, f.apply(cloneEdit(NEUTRAL)), (img) => {
        copy.getContext('2d')!.putImageData(img, 0, 0)
        if (!cancelled) setThumbs((th) => ({ ...th, [f.id]: copy.toDataURL('image/jpeg', 0.85) }))
        next()
      })
    }
    next()
    return () => {
      cancelled = true
    }
  }, [source])
  return (
    <div className="grid grid-cols-2 gap-2.5">
      {FILTERS.map((f) => {
        const active = (edit.filter ?? 'none') === f.id
        return (
          <button key={f.id} onClick={() => onPick(f.apply(edit))} className="text-left">
            <div className={clsx('aspect-square overflow-hidden rounded-lg bg-white/5', active ? 'ring-2 ring-[var(--accent)]' : 'ring-1 ring-white/10 hover:ring-white/30')}>
              {thumbs[f.id] && <img src={thumbs[f.id]} alt="" className="h-full w-full object-cover" />}
            </div>
            <div className={clsx('mt-1 text-[12px]', active ? 'text-white' : 'text-white/65')}>{f.name}</div>
          </button>
        )
      })}
    </div>
  )
}

const ASPECTS: Array<{ id: string; label: string; ratio: number | null | 'original' }> = [
  { id: 'free', label: t('Libre'), ratio: null },
  { id: 'original', label: t('Original'), ratio: 'original' },
  { id: '1:1', label: t('Carré'), ratio: 1 },
  { id: '4:3', label: '4:3', ratio: 4 / 3 },
  { id: '3:2', label: '3:2', ratio: 3 / 2 },
  { id: '16:9', label: '16:9', ratio: 16 / 9 },
  { id: '4:5', label: '4:5', ratio: 4 / 5 },
  { id: '9:16', label: '9:16', ratio: 9 / 16 }
]

/** Largest centered crop with the given pixel aspect inside a w×h frame, normalized. */
function aspectCrop(ratio: number, w: number, h: number): { x: number; y: number; w: number; h: number } {
  let cw = w
  let ch = w / ratio
  if (ch > h) {
    ch = h
    cw = h * ratio
  }
  return { x: (1 - cw / w) / 2, y: (1 - ch / h) / 2, w: cw / w, h: ch / h }
}

function CropPanel({ edit, onChange, srcW, srcH }: { edit: PhotoEdit; onChange(e: PhotoEdit): void; srcW: number; srcH: number }) {
  const g = edit.geometry
  const inscribed = planGeometry(srcW, srcH, { ...g, crop: null })
  const setG = (patch: Partial<PhotoEdit['geometry']>): void => onChange({ ...edit, geometry: { ...g, ...patch } })
  return (
    <div className="space-y-5">
      <div className="flex gap-2">
        <Button className="flex-1 bg-white/10 text-white hover:bg-white/16" onClick={() => setG({ rotate: ((g.rotate + 3) % 4) as 0 | 1 | 2 | 3, crop: null })}>
          <RotateCcwSquare className="size-4" /> {t('Pivoter')}
        </Button>
        <Button className="flex-1 bg-white/10 text-white hover:bg-white/16" onClick={() => setG({ flipH: !g.flipH })}>
          <FlipHorizontal2 className="size-4" /> {t('Miroir')}
        </Button>
      </div>
      <Slider label={t('Redresser')} value={g.straighten} min={-45} max={45} step={0.1} onChange={(v) => setG({ straighten: v })} format={(v) => `${v.toFixed(1)}°`} />
      <section>
        <h3 className="mb-2 text-[11px] font-semibold tracking-wide text-white/45 uppercase">{t('Proportions')}</h3>
        <div className="grid grid-cols-4 gap-1.5">
          {ASPECTS.map((a) => (
            <button
              key={a.id}
              onClick={() => {
                if (a.ratio === null) return setG({ crop: g.crop })
                const r = a.ratio === 'original' ? srcW / srcH : a.ratio
                setG({ crop: aspectCrop(r, inscribed.width, inscribed.height) })
              }}
              className="rounded-md bg-white/8 py-1.5 text-[11.5px] text-white/80 hover:bg-white/16"
            >
              {a.label}
            </button>
          ))}
        </div>
      </section>
      <Button className="w-full bg-white/10 text-white hover:bg-white/16" onClick={() => setG({ crop: null, straighten: 0, rotate: 0, flipH: false })}>
        <Sparkles className="size-4" /> {t('Réinitialiser le cadrage')}
      </Button>
      <p className="text-[11.5px] leading-relaxed text-white/45">{t('Faites glisser le cadre ou ses coins sur l’image. Le recadrage est appliqué en quittant cet onglet.')}</p>
    </div>
  )
}

type Handle = 'move' | 'nw' | 'ne' | 'sw' | 'se'

function CropOverlay({ edit, onChange, imgW, imgH }: { edit: PhotoEdit; onChange(e: PhotoEdit): void; imgW: number; imgH: number }) {
  const ref = useRef<HTMLDivElement>(null)
  const crop = edit.geometry.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const drag = useRef<{ h: Handle; x: number; y: number; start: typeof crop; ratio: number | null } | null>(null)
  const lockRatio = edit.geometry.crop && edit.geometry.crop.w * imgW / (edit.geometry.crop.h * imgH)

  const onDown = (h: Handle) => (e: RPointerEvent) => {
    e.stopPropagation()
    ;(e.target as HTMLElement).setPointerCapture(e.pointerId)
    drag.current = { h, x: e.clientX, y: e.clientY, start: { ...crop }, ratio: e.shiftKey && lockRatio ? lockRatio : null }
  }
  const onMove = (e: RPointerEvent): void => {
    const d = drag.current
    const el = ref.current
    if (!d || !el) return
    const r = el.getBoundingClientRect()
    const dx = (e.clientX - d.x) / r.width
    const dy = (e.clientY - d.y) / r.height
    let { x, y, w, h } = d.start
    const min = 0.05
    if (d.h === 'move') {
      x = Math.min(1 - w, Math.max(0, x + dx))
      y = Math.min(1 - h, Math.max(0, y + dy))
    } else {
      if (d.h.includes('w')) {
        const nx = Math.min(x + w - min, Math.max(0, x + dx))
        w += x - nx
        x = nx
      }
      if (d.h.includes('e')) w = Math.min(1 - x, Math.max(min, w + dx))
      if (d.h.includes('n')) {
        const ny = Math.min(y + h - min, Math.max(0, y + dy))
        h += y - ny
        y = ny
      }
      if (d.h.includes('s')) h = Math.min(1 - y, Math.max(min, h + dy))
    }
    onChange({ ...edit, geometry: { ...edit.geometry, crop: { x, y, w, h } } })
  }
  const pct = (v: number): string => `${v * 100}%`
  const corner = 'absolute size-4 border-white'
  return (
    <div ref={ref} className="absolute inset-0" onPointerMove={onMove} onPointerUp={() => (drag.current = null)}>
      <div className="absolute inset-0 bg-black/55" style={{ clipPath: `polygon(0 0, 100% 0, 100% 100%, 0 100%, 0 ${pct(crop.y)}, ${pct(crop.x)} ${pct(crop.y)}, ${pct(crop.x)} ${pct(crop.y + crop.h)}, ${pct(crop.x + crop.w)} ${pct(crop.y + crop.h)}, ${pct(crop.x + crop.w)} ${pct(crop.y)}, 0 ${pct(crop.y)})` }} />
      <div className="absolute cursor-move border border-white/90 shadow-[0_0_0_1px_rgba(0,0,0,0.4)]" style={{ left: pct(crop.x), top: pct(crop.y), width: pct(crop.w), height: pct(crop.h) }} onPointerDown={onDown('move')}>
        <div className="pointer-events-none absolute inset-0 grid grid-cols-3 grid-rows-3">
          {Array.from({ length: 9 }, (_, i) => <div key={i} className="border border-white/15" />)}
        </div>
        <div className={`${corner} -top-0.5 -left-0.5 cursor-nwse-resize border-t-[3px] border-l-[3px]`} onPointerDown={onDown('nw')} />
        <div className={`${corner} -top-0.5 -right-0.5 cursor-nesw-resize border-t-[3px] border-r-[3px]`} onPointerDown={onDown('ne')} />
        <div className={`${corner} -bottom-0.5 -left-0.5 cursor-nesw-resize border-b-[3px] border-l-[3px]`} onPointerDown={onDown('sw')} />
        <div className={`${corner} -right-0.5 -bottom-0.5 cursor-nwse-resize border-r-[3px] border-b-[3px]`} onPointerDown={onDown('se')} />
      </div>
    </div>
  )
}
