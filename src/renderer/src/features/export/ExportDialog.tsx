import { useEffect, useMemo, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { ChevronDown, Film, Globe, HardDrive, Printer, Send, Upload, X } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button, IconButton, Segmented } from '@/components/ui'
import { useUi } from '@/store'
import { bytes, plural } from '@/lib/format'
import { t, tn } from '@/i18n'
import { loadSettings, PHOTO_FORMATS, PHOTO_SIZES, PRESETS, saveSettings, VIDEO_FORMATS, VIDEO_SIZES, type ExportSettings } from './presets'

const ICONS: Record<string, ReactNode> = {
  share: <Send className="size-5" />,
  web: <Globe className="size-5" />,
  print: <Printer className="size-5" />,
  archive: <HardDrive className="size-5" />,
  edit: <Film className="size-5" />
}

const selectCls = 'w-full rounded-lg border border-line bg-bg px-2.5 py-1.5 text-[13px] outline-none focus:border-accent'

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] font-medium text-muted">{label}</span>
      {children}
    </label>
  )
}

export function describe(s: ExportSettings, photos: number, videos: number): string {
  const parts: string[] = []
  if (photos) {
    const f = s.photo.format === 'original' ? t('originaux') : s.photo.format.toUpperCase()
    parts.push(t('{what} en {format}', { what: plural(photos, 'photo', 'photos'), format: `${f}${s.photo.format !== 'original' && s.photo.maxSize ? ` ${s.photo.maxSize} px` : ''}` }))
  }
  if (videos) {
    const f = VIDEO_FORMATS.find((v) => v.value === s.video.format)?.label.split(' (')[0] ?? ''
    parts.push(t('{what} en {format}', { what: plural(videos, 'vidéo', 'vidéos'), format: `${s.video.format === 'original' ? t('originaux') : f}${s.video.format !== 'original' && s.video.maxHeight ? ` ${s.video.maxHeight}p` : ''}` }))
  }
  return parts.join(' · ')
}

export function ExportDialog() {
  const ids = useUi((s) => s.exportIds)
  const close = (): void => useUi.getState().setExportIds(null)
  const initial = useMemo(loadSettings, [ids])
  const [preset, setPreset] = useState(initial.preset)
  const [s, setS] = useState<ExportSettings>(initial.settings)
  const [advanced, setAdvanced] = useState(false)
  const [destination, setDestination] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const { data: summary } = useQuery({
    queryKey: ['export-summary', ids?.length, ids?.[0]],
    queryFn: () => api<{ photos: number; videos: number; live: number; bytes: number }>('/api/assets/summary', { method: 'POST', json: { ids } }),
    enabled: Boolean(ids?.length)
  })

  useEffect(() => {
    if (!ids) return
    setPreset(initial.preset)
    setS(initial.settings)
    setError(null)
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [ids, initial])

  if (!ids) return null
  const photos = summary?.photos ?? 0
  const videos = summary?.videos ?? 0
  const update = (patch: Partial<ExportSettings>): void => {
    setS({ ...s, ...patch })
    setPreset('custom')
  }

  const start = async (): Promise<void> => {
    setError(null)
    const dest = window.desktop ? await window.desktop.pickFolder({ title: t('Choisissez un dossier de destination'), button: t('Exporter ici') }) : destination.trim()
    if (!dest) return
    setBusy(true)
    try {
      await api('/api/export', { method: 'POST', json: { ...s, ids, destination: dest } })
      saveSettings(preset, s)
      close()
      useUi.getState().toast(t('Export lancé, suivez sa progression en bas de la barre latérale'))
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/35 backdrop-blur-[2px]" onMouseDown={close}>
      <div className="animate-pop-in flex max-h-[90vh] w-[640px] max-w-[94vw] flex-col rounded-2xl border border-line bg-surface shadow-2xl dark:bg-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Upload className="size-4 text-accent" />
          <div className="min-w-0 flex-1">
            <h2 className="font-display text-[16px] font-semibold">{tn(ids.length, 'Exporter {n} élément', 'Exporter {n} éléments')}</h2>
            {summary && <p className="text-[12px] text-muted">{[photos ? plural(photos, 'photo', 'photos') : '', videos ? plural(videos, 'vidéo', 'vidéos') : '', bytes(summary.bytes)].filter(Boolean).join(' · ')}</p>}
          </div>
          <IconButton label={t('Fermer')} onClick={close}>
            <X className="size-4" />
          </IconButton>
        </div>

        <div className="scroll-thin space-y-5 overflow-y-auto p-5">
          <div className="grid grid-cols-5 gap-2">
            {PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => {
                  setPreset(p.id)
                  setS(p.settings)
                }}
                className={clsx(
                  'flex flex-col items-center gap-1.5 rounded-xl border px-2 py-3 text-center transition-colors',
                  preset === p.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover'
                )}
              >
                <span className={preset === p.id ? 'text-accent' : 'text-muted'}>{ICONS[p.id]}</span>
                <span className="text-[12.5px] font-semibold">{p.title}</span>
                <span className="text-[10.5px] leading-tight text-muted">{p.subtitle}</span>
              </button>
            ))}
          </div>

          <div className="rounded-xl bg-hover px-3.5 py-2.5 text-[12.5px]">
            {describe(s, photos, videos) || '…'}
            {preset === 'custom' && <span className="ml-1 text-muted">{t('(personnalisé)')}</span>}
          </div>

          <button onClick={() => setAdvanced((a) => !a)} className="flex items-center gap-1.5 text-[12.5px] font-medium text-accent">
            <ChevronDown className={clsx('size-4 transition-transform', advanced && 'rotate-180')} />
            {t('Réglages détaillés')}
          </button>

          {advanced && (
            <div className="animate-fade-in space-y-5">
              {photos > 0 && (
                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold">{t('Photos')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('Format')}>
                      <select className={selectCls} value={s.photo.format} onChange={(e) => update({ photo: { ...s.photo, format: e.target.value as ExportSettings['photo']['format'] } })}>
                        {PHOTO_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </Field>
                    <Field label={t('Taille (plus grand côté)')}>
                      <select className={selectCls} disabled={s.photo.format === 'original'} value={s.photo.maxSize ?? 0} onChange={(e) => update({ photo: { ...s.photo, maxSize: Number(e.target.value) || null } })}>
                        {PHOTO_SIZES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  {['jpeg', 'webp', 'avif'].includes(s.photo.format) && (
                    <Field label={t('Qualité · {q}', { q: s.photo.quality })}>
                      <input type="range" min={40} max={100} value={s.photo.quality} onChange={(e) => update({ photo: { ...s.photo, quality: Number(e.target.value) } })} className="w-full accent-[var(--accent)]" />
                    </Field>
                  )}
                </section>
              )}
              {videos > 0 && (
                <section className="space-y-3">
                  <h3 className="text-[13px] font-semibold">{t('Vidéos')}</h3>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label={t('Format')}>
                      <select className={selectCls} value={s.video.format} onChange={(e) => update({ video: { ...s.video, format: e.target.value as ExportSettings['video']['format'] } })}>
                        {VIDEO_FORMATS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </Field>
                    <Field label={t('Résolution')}>
                      <select className={selectCls} disabled={s.video.format === 'original'} value={s.video.maxHeight ?? 0} onChange={(e) => update({ video: { ...s.video, maxHeight: Number(e.target.value) || null } })}>
                        {VIDEO_SIZES.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
                      </select>
                    </Field>
                  </div>
                  {s.video.format !== 'original' && (
                    <Field label={t('Qualité')}>
                      <Segmented size="sm" value={s.video.quality} onChange={(q) => update({ video: { ...s.video, quality: q } })} options={[{ value: 'high', label: t('Haute') }, { value: 'medium', label: t('Équilibrée') }, { value: 'small', label: t('Légère') }]} />
                    </Field>
                  )}
                </section>
              )}
              <section className="grid grid-cols-2 gap-3">
                <Field label={t('Métadonnées')}>
                  <select className={selectCls} value={s.metadata} onChange={(e) => update({ metadata: e.target.value as ExportSettings['metadata'] })}>
                    <option value="all">{t('Toutes (date, appareil, lieu)')}</option>
                    <option value="noLocation">{t('Sans la localisation')}</option>
                    <option value="none">{t('Aucune')}</option>
                  </select>
                </Field>
                <Field label={t('Rangement')}>
                  <select className={selectCls} value={s.folders} onChange={(e) => update({ folders: e.target.value as ExportSettings['folders'] })}>
                    <option value="flat">{t('Tout dans le dossier choisi')}</option>
                    <option value="year">{t('Un dossier par année')}</option>
                    <option value="yearMonth">{t('Par année puis par mois')}</option>
                  </select>
                </Field>
                <Field label={t('Nom des fichiers')}>
                  <select className={selectCls} value={s.naming} onChange={(e) => update({ naming: e.target.value as ExportSettings['naming'] })}>
                    <option value="original">{t('Nom d’origine')}</option>
                    <option value="date">{t('Date et heure de prise de vue')}</option>
                    <option value="custom">{t('Personnalisé…')}</option>
                  </select>
                </Field>
                {s.naming === 'custom' && (
                  <Field label={t('Modèle')}>
                    <input className={selectCls} value={s.pattern ?? '{date}_{n}'} onChange={(e) => update({ pattern: e.target.value })} />
                    <span className="mt-1 block text-[11px] text-faint">{'{date} {time} {year} {month} {day} {n} {name} {camera}'}</span>
                  </Field>
                )}
              </section>
              <section className="space-y-2 text-[13px]">
                {(summary?.live ?? 0) > 0 && (
                  <label className="flex items-center gap-2">
                    <input type="checkbox" checked={s.includeLiveVideo} onChange={(e) => update({ includeLiveVideo: e.target.checked })} className="accent-[var(--accent)]" />
                    {t('Inclure la vidéo des Live Photos')}
                  </label>
                )}
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={Boolean(s.includeRaw)} onChange={(e) => update({ includeRaw: e.target.checked })} className="accent-[var(--accent)]" />
                  {t('Joindre le fichier RAW des photos RAW + JPEG')}
                </label>
                <label className="flex items-center gap-2">
                  <input type="checkbox" checked={s.setFileDates} onChange={(e) => update({ setFileDates: e.target.checked })} className="accent-[var(--accent)]" />
                  {t('Dater les fichiers à la date de prise de vue')}
                </label>
              </section>
            </div>
          )}

          {!window.desktop && (
            <Field label={t('Dossier de destination sur l’ordinateur de la photothèque')}>
              <input className={selectCls} value={destination} onChange={(e) => setDestination(e.target.value)} placeholder={t('/Users/vous/Desktop/Export')} />
            </Field>
          )}
          {error && <p className="text-[12.5px] text-red-500">{error}</p>}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={close}>{t('Annuler')}</Button>
          <Button variant="primary" onClick={() => void start()} disabled={busy || (!window.desktop && !destination.trim())}>
            {window.desktop ? t('Choisir le dossier et exporter…') : t('Exporter')}
          </Button>
        </div>
      </div>
    </div>
  )
}
