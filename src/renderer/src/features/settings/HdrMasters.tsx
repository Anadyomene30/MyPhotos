import { useEffect, useState } from 'react'
import { FolderOpen, Wand2 } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { t } from '@/i18n'

interface MastersState {
  dir: string
  isDefault: boolean
  available: boolean
}

/** Folder for the 16-bit TIFF masters of HDR fusions made from RAW files (about 70 MB each). */
export function HdrMastersSettings() {
  const [state, setState] = useState<MastersState | null>(null)
  const [error, setError] = useState<string | null>(null)
  const load = (): void => void api<MastersState>('/api/settings/hdr-masters').then(setState)
  useEffect(load, [])
  const set = async (dir: string | null): Promise<void> => {
    setError(null)
    try {
      await api('/api/settings/hdr-masters', { method: 'PUT', json: { dir } })
      load()
    } catch (e) {
      setError((e as Error).message)
    }
  }
  const choose = async (): Promise<void> => {
    const dir = await window.desktop?.pickFolder({ title: t('Dossier des masters 16 bits'), button: t('Choisir') })
    if (dir) await set(dir)
  }
  if (!state) return null
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold"><Wand2 className="size-4 text-accent" /> {t('Masters 16 bits des photos HDR')}</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        {t('Une série prise en RAW donne, en plus de la photo HDR, un TIFF 16 bits pour l’étalonnage (environ 70 Mo). Il est rangé ici, jamais dans vos dossiers de photos.')}
      </p>
      <div className="flex items-center gap-2">
        <div className="min-w-0 flex-1 truncate rounded-card border border-line bg-bg px-3 py-1.5 text-[12.5px]" title={state.dir}>{state.dir}</div>
        {window.desktop && (
          <Button onClick={() => void choose()}>
            <FolderOpen className="size-4" /> {t('Choisir…')}
          </Button>
        )}
        {!state.isDefault && <Button variant="ghost" onClick={() => void set(null)}>{t('Par défaut')}</Button>}
      </div>
      {!state.available && <p className="mt-2 text-[12px] text-muted">{t('Dossier introuvable pour le moment (disque débranché ?) : les photos HDR se créent sans master.')}</p>}
      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
    </section>
  )
}
