import { useState } from 'react'
import { FolderTree, Loader2 } from 'lucide-react'
import { api } from '@/api/client'
import { useLibraryState } from '@/api/hooks'
import { Button } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { useUi } from '@/store'
import { t, tn } from '@/i18n'

interface Plan {
  count: number
  alreadyTidy: number
  skipped: number
  sample: string[]
  sourcePath: string
}

/** Settings section: propose a Year/Month Moment folder layout and apply it on request only. */
export function OrganizeSettings() {
  const { data } = useLibraryState()
  const [plan, setPlan] = useState<Plan | null>(null)
  const [sourceId, setSourceId] = useState<number | null>(null)
  const [busy, setBusy] = useState(false)
  const sources = (data?.sources ?? []).filter((s) => !/MyPhotos Créations$/.test(s.path))
  if (!sources.length) return null

  const preview = async (id: number): Promise<void> => {
    setBusy(true)
    setSourceId(id)
    try {
      setPlan(await api<Plan>(`/api/organize/plan/${id}`))
    } catch (e) {
      useUi.getState().toast((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const apply = async (): Promise<void> => {
    if (!plan || sourceId === null) return
    const ok = await confirm({
      title: tn(plan.count, 'Déplacer {n} fichier ?', 'Déplacer {n} fichiers ?'),
      message: t('Les fichiers seront rangés dans des dossiers Année / Mois Moment à l’intérieur de {path}. Ils restent sur le même disque et ne sont ni copiés ni modifiés. Cette opération n’a pas d’annulation automatique.', { path: plan.sourcePath }),
      confirmLabel: t('Ranger les fichiers'),
      danger: true
    })
    if (!ok) return
    await api(`/api/organize/apply/${sourceId}`, { method: 'POST' })
    useUi.getState().toast(t('Rangement en cours, suivez la progression en bas de la barre latérale'))
    setPlan(null)
  }

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold"><FolderTree className="size-4 text-accent" /> {t('Ranger les fichiers dans des dossiers')}</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        {t('MyPhotos peut réorganiser un dossier de la photothèque en')} <span className="text-fg">{t('Année / Mois Moment')}</span> {t('(par exemple « 2019/2019-08 Séjour à Florence »). Vous voyez d’abord un aperçu ; rien n’est déplacé sans votre confirmation.')}
      </p>
      <div className="flex flex-wrap gap-2">
        {sources.map((s) => (
          <Button key={s.id} disabled={busy} onClick={() => void preview(s.id)}>
            {busy && sourceId === s.id ? <Loader2 className="size-3.5 animate-spin" /> : null} {t('Aperçu pour {name}', { name: s.path.split('/').pop() ?? '' })}
          </Button>
        ))}
      </div>
      {plan && (
        <div className="mt-3 rounded-card border border-line p-3.5 text-[12.5px]">
          <div>
            <span className="font-bold">{tn(plan.count, '{n} fichier à déplacer', '{n} fichiers à déplacer')}</span> · {tn(plan.alreadyTidy, '{n} déjà bien rangé', '{n} déjà bien rangés')} · {tn(plan.skipped, '{n} sans date fiable (laissé en place)', '{n} sans date fiable (laissés en place)')}
          </div>
          {plan.sample.length > 0 && (
            <ul className="mt-2 max-h-40 space-y-0.5 overflow-y-auto font-mono text-[11px] text-muted">
              {plan.sample.map((p) => <li key={p} className="truncate">{p}</li>)}
              {plan.count > plan.sample.length && <li>…</li>}
            </ul>
          )}
          <div className="mt-3 flex justify-end gap-2">
            <Button onClick={() => setPlan(null)}>{t('Fermer')}</Button>
            <Button variant="danger" disabled={!plan.count} onClick={() => void apply()}>{tn(plan.count, 'Ranger {n} fichier', 'Ranger {n} fichiers')}</Button>
          </div>
        </div>
      )}
    </section>
  )
}
