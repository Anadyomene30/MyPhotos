import clsx from 'clsx'
import { Clapperboard, Loader2, Pin, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui'
import { media } from '@/api/client'
import { useMemories } from '@/api/hooks'
import { useUi } from '@/store'
import { plural } from '@/lib/format'
import { t } from '@/i18n'
import type { MemorySummary } from '@shared/types'

const KIND_LABEL: Record<MemorySummary['kind'], string> = {
  year: t('Année'), trip: t('Voyage'), moment: t('Moment'), person: t('Personne'), category: t('Thème'), onThisDay: t('Souvenir du jour'), custom: t('Personnalisé')
}

function MemoryCard({ m, big }: { m: MemorySummary; big?: boolean }) {
  const open = useUi((s) => s.openMemory)
  return (
    <button
      onClick={() => open(m.id)}
      className={clsx('group relative overflow-hidden rounded-2xl text-left text-white transition-transform hover:scale-[1.015]', big ? 'aspect-[16/9] col-span-2 row-span-2' : 'aspect-[4/5]')}
      style={{ background: m.theme.bg }}
    >
      {m.coverId && <img src={media.preview(m.coverId, m.coverV)} alt="" className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105" draggable={false} />}
      <div className="absolute inset-0 bg-gradient-to-t from-black/75 via-black/15 to-transparent" />
      <div className="absolute top-3 left-3 flex items-center gap-1.5">
        <span className="rounded-full bg-white/18 px-2 py-0.5 text-[10.5px] font-semibold tracking-wide uppercase">{KIND_LABEL[m.kind]}</span>
        {m.pinned && <Pin className="size-3.5 fill-white" />}
      </div>
      <div className="absolute right-4 bottom-4 left-4">
        <h3 className={clsx('font-display font-bold leading-tight tracking-tight drop-shadow', big ? 'text-[30px]' : 'text-[19px]')}>{m.title}</h3>
        <p className="mt-0.5 truncate text-[12px] text-white/80">{m.subtitle ?? plural(m.count, 'photo', 'photos')}</p>
      </div>
    </button>
  )
}

export function MemoriesPage() {
  const { data: memories, isLoading } = useMemories()
  const win = window.desktop && window.desktop.platform !== 'darwin'
  const today = (memories ?? []).filter((m) => m.kind === 'onThisDay')
  const rest = (memories ?? []).filter((m) => m.kind !== 'onThisDay')
  return (
    <div className="flex h-full flex-col">
      <header className={clsx('drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line pl-5', win ? 'pr-[150px]' : 'pr-4')}>
        <h1 className="etiquette">{t('Souvenirs')}</h1>
        <span className="flex-1 text-[12px] text-muted">{memories ? plural(memories.length, 'souvenir composé', 'souvenirs composés') : ''}</span>
        <Button variant="primary" className="no-drag py-1 text-[12.5px]" onClick={() => useUi.getState().openRetro({ source: { type: 'all' } })}>
          <Clapperboard className="size-4" /> {t('Créer une vidéo souvenir')}
        </Button>
      </header>
      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-10">
        {isLoading && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-faint" />}
        {memories && memories.length === 0 && (
          <div className="mx-auto mt-16 max-w-md text-center">
            <Sparkles className="mx-auto mb-3 size-10 text-faint" strokeWidth={1.4} />
            <h2 className="font-display text-[18px] font-semibold">{t('Vos souvenirs arrivent')}</h2>
            <p className="mt-2 text-[13px] text-muted">{t('MyPhotos compose des sélections automatiques (meilleures photos d’une année, voyages, personnes, thèmes) une fois la photothèque analysée.')}</p>
          </div>
        )}
        {today.length > 0 && (
          <section className="mt-5">
            <h2 className="mb-2 font-display text-[17px] font-semibold">{t('Ce jour-là')}</h2>
            <div className="grid grid-cols-4 gap-3">{today.map((m) => <MemoryCard key={m.id} m={m} />)}</div>
          </section>
        )}
        {rest.length > 0 && (
          <section className="mt-6">
            <h2 className="mb-2 font-display text-[17px] font-semibold">{t('Pour vous')}</h2>
            <div className="grid grid-cols-4 gap-3">
              {rest.map((m, i) => <MemoryCard key={m.id} m={m} big={i === 0} />)}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}
