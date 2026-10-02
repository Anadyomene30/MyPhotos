import { useEffect, useState } from 'react'
import { FolderPlus, Loader2, RefreshCw, Trash2, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { useLibraryState } from '@/api/hooks'
import { Button, IconButton, Segmented } from '@/components/ui'
import { useUi, type Theme } from '@/store'
import { useAddSource } from '@/features/onboarding/Welcome'
import { plural } from '@/lib/format'
import { t } from '@/i18n'
import { IntelligenceSettings } from './Intelligence'
import { CloudSettings } from './Cloud'
import { OrganizeSettings } from './Organize'
import { OwnerSettings } from './Owner'
import { LanguageSettings } from './Language'
import { UpdateSettings } from './Updates'
import { useModal } from '@/components/useModal'

export function Settings() {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettingsOpen)
  const theme = useUi((s) => s.theme)
  const setTheme = useUi((s) => s.setTheme)
  const { data } = useLibraryState()
  const qc = useQueryClient()
  const { add, busy, error } = useAddSource()
  const [path, setPath] = useState('')

  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        setOpen(false)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, setOpen])

  const panelRef = useModal<HTMLDivElement>(open)
  if (!open) return null

  const remove = async (id: number): Promise<void> => {
    await api(`/api/sources/${id}`, { method: 'DELETE' })
    await qc.invalidateQueries()
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/30" onMouseDown={() => setOpen(false)}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="settings-title" className="animate-pop-in flex max-h-[88vh] w-[560px] max-w-[92vw] flex-col rounded-sheet border border-line bg-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 id="settings-title" className="font-display text-[16px] font-semibold">{t('Réglages')}</h2>
          <IconButton label={t('Fermer')} onClick={() => setOpen(false)}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="scroll-thin space-y-6 overflow-y-auto p-5">
          <section>
            <div className="mb-2 flex items-center justify-between">
              <h3 className="text-[13px] font-semibold">{t('Dossiers de la photothèque')}</h3>
              <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={() => void api('/api/rescan', { method: 'POST' })}>
                <RefreshCw className="size-3.5" /> {t('Réanalyser')}
              </Button>
            </div>
            <div className="overflow-hidden rounded-card border border-line">
              {data?.sources.length ? (
                data.sources.map((s) => (
                  <div key={s.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px]" title={s.path}>{s.path}</div>
                      <div className="text-[11.5px] text-muted">{plural(s.assetCount, 'élément', 'éléments')}</div>
                    </div>
                    <IconButton label={t('Retirer ce dossier (les fichiers ne sont pas supprimés)')} onClick={() => void remove(s.id)}>
                      <Trash2 className="size-4" />
                    </IconButton>
                  </div>
                ))
              ) : (
                <div className="px-3.5 py-3 text-[13px] text-muted">{t('Aucun dossier.')}</div>
              )}
            </div>
            {window.desktop ? (
              <Button className="mt-3" onClick={() => void add()} disabled={busy}>
                {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />} {t('Ajouter un dossier…')}
              </Button>
            ) : (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); void add(path.trim()).then(() => setPath('')) }}>
                <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={t('Chemin du dossier')} className="min-w-0 flex-1 rounded-card border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-accent" />
                <Button type="submit" disabled={busy || !path.trim()}>{t('Ajouter')}</Button>
              </form>
            )}
            {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
            <p className="mt-2 text-[11.5px] text-faint">{t('Retirer un dossier le retire seulement de MyPhotos. Vos fichiers restent intacts.')}</p>
          </section>
          <OwnerSettings />
          <IntelligenceSettings />
          <CloudSettings />
          <OrganizeSettings />
          <LanguageSettings />
          <UpdateSettings />
          <section className="flex items-center justify-between">
            <h3 className="text-[13px] font-semibold">{t('Apparence')}</h3>
            <Segmented<Theme>
              size="sm"
              value={theme}
              onChange={setTheme}
              options={[{ value: 'system', label: t('Auto') }, { value: 'light', label: t('Clair') }, { value: 'dark', label: t('Sombre') }]}
            />
          </section>
        </div>
      </div>
    </div>
  )
}
