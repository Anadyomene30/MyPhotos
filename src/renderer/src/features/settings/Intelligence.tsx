import { Check, Download, Loader2, Sparkles, X } from 'lucide-react'
import { mlApi, useMlStatus } from '@/api/hooks'
import { Button } from '@/components/ui'
import { bytes, plural } from '@/lib/format'
import { t, tn } from '@/i18n'

/** Settings section: enable local intelligence, download model packs, show progress. */
export function IntelligenceSettings() {
  const { data: s, refetch } = useMlStatus()
  if (!s) return null
  const toggle = async (): Promise<void> => {
    await mlApi.enable(!s.enabled)
    await refetch()
  }
  const allInstalled = s.packs.every((p) => s.installed[p.id])
  return (
    <section>
      <div className="mb-2 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold"><Sparkles className="size-4 text-accent" /> {t('Intelligence locale')}</h3>
        <label className="flex items-center gap-2 text-[12.5px]">
          <input type="checkbox" className="accent-[var(--accent)]" checked={s.enabled} onChange={() => void toggle()} />
          {s.enabled ? t('Activée') : t('Désactivée')}
        </label>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        {t('Reconnaît les personnes, comprend le contenu des photos (recherche « chien sur la plage », catégories automatiques) et retrouve les photos semblables.')}{' '}
        {t('Tout tourne sur cet ordinateur : rien n’est envoyé sur internet, sauf le téléchargement initial des modèles.')}
      </p>
      <div className="overflow-hidden rounded-card border border-line">
        {s.packs.map((p) => {
          const installed = s.installed[p.id]
          const dl = s.download?.pack === p.id ? s.download : null
          return (
            <div key={p.id} className="flex items-center gap-3 border-b border-line px-3.5 py-2.5 last:border-b-0">
              <div className="min-w-0 flex-1">
                <div className="text-[13px]">{p.title}</div>
                <div className="text-[11.5px] text-muted">{bytes(p.bytes)}{installed ? ` · ${t('installé')}` : ''}</div>
                {dl && (
                  <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-line">
                    <div className="h-full bg-accent transition-[width]" style={{ width: `${dl.total ? (dl.done / dl.total) * 100 : 0}%` }} />
                  </div>
                )}
              </div>
              {installed ? (
                <Check className="size-4 text-emerald-500" />
              ) : dl ? (
                <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={() => void mlApi.cancelDownload()}>
                  <X className="size-3.5" /> {bytes(dl.done)}
                </Button>
              ) : (
                <Button className="py-1 text-[12px]" disabled={Boolean(s.download)} onClick={() => void mlApi.download(p.id)}>
                  <Download className="size-3.5" /> {t('Télécharger')}
                </Button>
              )}
            </div>
          )
        })}
      </div>
      {s.error && <p className="mt-2 text-[12px] text-red-500">{s.error}</p>}
      {s.enabled && allInstalled && (
        <p className="mt-2 flex items-center gap-1.5 text-[11.5px] text-faint">
          {s.pending > 0 ? <Loader2 className="size-3 animate-spin" /> : <Check className="size-3 text-emerald-500" />}
          {s.pending > 0 ? tn(s.pending, 'Analyse en cours : {n} élément restant', 'Analyse en cours : {n} éléments restants') : tn(s.done, '{n} élément analysé', '{n} éléments analysés')} · {plural(s.persons, 'personne', 'personnes')}
        </p>
      )}
      {!s.workerAvailable && <p className="mt-2 text-[12px] text-red-500">{t('Le module d’analyse n’est pas disponible dans cette installation.')}</p>}
    </section>
  )
}
