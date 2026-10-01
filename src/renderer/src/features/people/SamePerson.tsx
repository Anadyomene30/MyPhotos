import { useState } from 'react'
import { Check, HelpCircle, X } from 'lucide-react'
import { media } from '@/api/client'
import { mlApi, usePersonSuggestions } from '@/api/hooks'
import { Button } from '@/components/ui'
import { plural } from '@/lib/format'
import { t, tn } from '@/i18n'
import type { PersonPair, PersonSummary } from '@shared/types'

function Side({ p, faces }: { p: PersonSummary; faces: number[] }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-2">
      <div className="grid grid-cols-2 gap-1">
        {faces.slice(0, 4).map((f) => (
          <img key={f} src={media.face(f)} alt="" className="tile-bg size-[58px] rounded-lg object-cover" draggable={false} />
        ))}
      </div>
      <div className="max-w-[130px] truncate text-center text-[12.5px]">
        <span className={p.name ? 'font-semibold' : 'text-muted italic'}>{p.name ?? t('Sans nom')}</span>
        <span className="text-faint"> · {plural(p.photos, 'photo', 'photos')}</span>
      </div>
    </div>
  )
}

/** "Is this the same person?" prompts, one pair at a time, most likely first. */
export function SamePersonPrompt() {
  const { data, refetch } = usePersonSuggestions()
  const [skipped, setSkipped] = useState<Set<string>>(new Set())
  const [busy, setBusy] = useState(false)
  const key = (x: PersonPair): string => `${x.a.id}:${x.b.id}`
  const pending = (data ?? []).filter((x) => !skipped.has(key(x)))
  const pair = pending[0]
  if (!pair) return null

  const answer = async (same: boolean): Promise<void> => {
    setBusy(true)
    try {
      if (same) await mlApi.merge(pair.a.id, [pair.b.id])
      else await mlApi.notSame(pair.a.id, pair.b.id)
      setSkipped((s) => new Set(s).add(key(pair)))
      await refetch()
    } finally {
      setBusy(false)
    }
  }

  return (
    <section className="mt-4 flex flex-wrap items-center gap-6 rounded-2xl border border-line bg-surface p-4 shadow-sm dark:bg-elevated">
      <div className="flex items-center gap-4">
        <Side p={pair.a} faces={pair.aFaces} />
        <HelpCircle className="size-6 shrink-0 text-faint" />
        <Side p={pair.b} faces={pair.bFaces} />
      </div>
      <div className="min-w-[200px] flex-1">
        <h2 className="font-display text-[16px] font-semibold">{t('Est-ce la même personne ?')}</h2>
        <p className="mt-1 text-[12.5px] text-muted">
          {t('MyPhotos a parfois séparé une même personne en deux, par exemple à des âges différents.')} {pending.length > 1 ? tn(pending.length, '{n} suggestion à vérifier.', '{n} suggestions à vérifier.') : t('Dernière suggestion.')}
        </p>
        <div className="mt-3 flex gap-2">
          <Button variant="primary" disabled={busy} onClick={() => void answer(true)}><Check className="size-4" /> {t('Oui, regrouper')}</Button>
          <Button disabled={busy} onClick={() => void answer(false)}><X className="size-4" /> {t('Non')}</Button>
          <Button variant="ghost" disabled={busy} onClick={() => setSkipped((s) => new Set(s).add(key(pair)))}>{t('Plus tard')}</Button>
        </div>
      </div>
    </section>
  )
}
