import { t } from '@/i18n'
import { useState } from 'react'
import { FolderPlus, Loader2 } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { GlobeScene } from '@/components/Globe'

export function useAddSource() {
  const qc = useQueryClient()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const add = async (path?: string | null): Promise<void> => {
    setError(null)
    const chosen = path ?? (window.desktop ? await window.desktop.pickFolder({ title: t('Choisir un dossier de photos'), button: t('Ajouter à la photothèque') }) : null)
    if (!chosen) return
    setBusy(true)
    try {
      await api('/api/sources', { method: 'POST', json: { path: chosen } })
      await qc.invalidateQueries({ queryKey: ['state'] })
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }
  return { add, busy, error }
}

export function Welcome() {
  const { add, busy, error } = useAddSource()
  const [path, setPath] = useState('')
  const desktop = Boolean(window.desktop)

  return (
    <div className="drag relative grid h-full place-items-center overflow-hidden">
      <div className="animate-pop-in relative flex max-w-md flex-col items-center px-8 text-center">
        <div className="mb-6">
          <GlobeScene />
        </div>
        <h1 className="etiquette grande">{t('Bienvenue dans MyPhotos')}</h1>
        <p className="mt-3 text-[14px] leading-relaxed text-muted">
          {t('Choisissez le dossier où se trouvent vos photos et vidéos. MyPhotos les lit sur place : vos fichiers ne sont ni copiés, ni déplacés, ni modifiés.')}
        </p>
        {desktop ? (
          <Button variant="primary" className="no-drag mt-7 px-5 py-2.5 text-[14px]" onClick={() => void add()} disabled={busy}>
            {busy ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
            {t('Choisir un dossier…')}
          </Button>
        ) : (
          <form
            className="no-drag mt-7 flex w-full gap-2"
            onSubmit={(e) => {
              e.preventDefault()
              void add(path.trim())
            }}
          >
            <input
              value={path}
              onChange={(e) => setPath(e.target.value)}
              placeholder={t('/Users/vous/Pictures')}
              className="min-w-0 flex-1 rounded-card border border-line bg-surface px-3 py-2 text-[13px] outline-none focus:border-accent"
            />
            <Button variant="primary" type="submit" disabled={busy || !path.trim()}>
              {t('Ajouter')}
            </Button>
          </form>
        )}
        {error && <p className="mt-3 text-[12.5px] text-red-500">{error}</p>}
        <p className="mt-6 text-[12px] text-faint">{t('Vous pourrez ajouter d’autres dossiers plus tard dans les réglages.')}</p>
      </div>
    </div>
  )
}
