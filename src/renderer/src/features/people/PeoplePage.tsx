import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronRight, Eye, EyeOff, Loader2, Merge, Pencil, Sparkles, Users, X } from 'lucide-react'
import { media } from '@/api/client'
import { mlApi, useMlStatus, usePersons } from '@/api/hooks'
import { Button, IconButton } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { useUi } from '@/store'
import { t, tn } from '@/i18n'
import { plural } from '@/lib/format'
import type { PersonSummary } from '@shared/types'
import { SamePersonPrompt } from './SamePerson'

/** unnamed people seen on fewer photos than this go under "Autres visages" */
const MAIN_MIN_PHOTOS = 3

export function PersonAvatar({ person, size = 40, className }: { person: Pick<PersonSummary, 'coverFaceId' | 'name'>; size?: number; className?: string }) {
  return (
    <div className={clsx('tile-bg shrink-0 overflow-hidden rounded-full', className)} style={{ width: size, height: size }}>
      {person.coverFaceId ? <img src={media.face(person.coverFaceId)} alt="" className="h-full w-full object-cover" draggable={false} /> : <Users className="m-auto size-1/2 text-faint" />}
    </div>
  )
}

function NameEditor({ person, onDone }: { person: PersonSummary; onDone(): void }) {
  const [v, setV] = useState(person.name ?? '')
  const ref = useRef<HTMLInputElement>(null)
  useEffect(() => ref.current?.select(), [])
  const save = async (): Promise<void> => {
    await mlApi.renamePerson(person.id, v.trim() || null)
    onDone()
  }
  return (
    <form
      onSubmit={(e) => {
        e.preventDefault()
        void save()
      }}
      onClick={(e) => e.stopPropagation()}
      className="flex items-center gap-1"
    >
      <input ref={ref} value={v} onChange={(e) => setV(e.target.value)} placeholder={t('Nom')} className="w-full min-w-0 rounded-card border border-accent bg-bg px-2 py-0.5 text-center text-[12.5px] outline-none" onKeyDown={(e) => e.key === 'Escape' && onDone()} />
      <button type="submit" className="grid size-6 shrink-0 place-items-center rounded-card bg-accent text-on-accent"><Check className="size-3.5" /></button>
    </form>
  )
}

export function PeoplePage() {
  const { data: status } = useMlStatus()
  const [showAll, setShowAll] = useState(false)
  const { data: persons, isLoading } = usePersons(showAll)
  const [selected, setSelected] = useState<Set<number>>(new Set())
  const [editing, setEditing] = useState<number | null>(null)
  const [showHidden, setShowHidden] = useState(false)
  const openPerson = useUi((s) => s.openPerson)
  const win = window.desktop && window.desktop.platform !== 'darwin'

  const list = (persons ?? []).filter((p) => showHidden || !p.hidden)
  const named = list.filter((p) => p.name)
  const unnamed = list.filter((p) => !p.name && p.photos >= MAIN_MIN_PHOTOS)
  const others = list.filter((p) => !p.name && p.photos < MAIN_MIN_PHOTOS)
  const [showOthers, setShowOthers] = useState(false)

  const toggle = (id: number, additive: boolean): void => {
    setSelected((s) => {
      const n = additive ? new Set(s) : new Set<number>()
      if (s.has(id) && additive) n.delete(id)
      else n.add(id)
      return n
    })
  }

  const merge = async (): Promise<void> => {
    const ids = [...selected]
    const withName = list.filter((p) => ids.includes(p.id) && p.name)
    const into = withName[0]?.id ?? ids[0]!
    const ok = await confirm({
      title: t('Fusionner {n} personnes ?', { n: ids.length }),
      message: withName.length > 1 ? t('Les visages seront regroupés sous « {name} ». Les autres noms seront perdus.', { name: withName[0]!.name ?? '' }) : t('Les visages seront regroupés en une seule personne.'),
      confirmLabel: t('Fusionner')
    })
    if (!ok) return
    await mlApi.merge(into, ids.filter((i) => i !== into))
    setSelected(new Set())
  }

  const Card = ({ p }: { p: PersonSummary }): React.JSX.Element => {
    const sel = selected.has(p.id)
    return (
      <div
        role="button"
        tabIndex={0}
        onClick={(e) => (e.metaKey || e.ctrlKey || selected.size ? toggle(p.id, true) : openPerson(p.id))}
        onDoubleClick={() => setEditing(p.id)}
        className={clsx('group flex w-[132px] cursor-pointer flex-col items-center gap-2 rounded-card p-3 text-center transition-colors hover:bg-hover', sel && 'bg-accent-soft ring-2 ring-accent', p.hidden && 'opacity-50')}
      >
        <div className="relative">
          <PersonAvatar person={p} size={96} className="ring-2 ring-surface" />
          <button
            className={clsx('absolute -top-1 -left-1 grid size-6 place-items-center rounded-full border-2 border-surface transition-opacity', sel ? 'bg-accent text-on-accent opacity-100' : 'bg-surface/90 text-faint opacity-0 group-hover:opacity-100')}
            onClick={(e) => {
              e.stopPropagation()
              toggle(p.id, true)
            }}
            aria-label={t('Sélectionner')}
          >
            <Check className="size-3.5" strokeWidth={3} />
          </button>
          <button
            className="absolute -right-1 -bottom-1 grid size-7 place-items-center rounded-full border-2 border-surface bg-surface text-muted opacity-0 transition-opacity group-hover:opacity-100 hover:text-fg"
            onClick={(e) => {
              e.stopPropagation()
              setEditing(p.id)
            }}
            aria-label={t('Nommer')}
          >
            <Pencil className="size-3.5" />
          </button>
        </div>
        {editing === p.id ? (
          <NameEditor person={p} onDone={() => setEditing(null)} />
        ) : (
          <div className="w-full">
            <div className={clsx('truncate text-[13px] font-medium', !p.name && 'text-muted italic')}>{p.name ?? t('Sans nom')}</div>
            <div className="text-[11.5px] text-faint">{plural(p.photos, 'photo', 'photos')}</div>
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <header className={clsx('drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line pl-5', win ? 'pr-[150px]' : 'pr-4')}>
        <Users className="size-[18px] text-accent" />
        <h1 className="font-display text-[15px] font-semibold tracking-tight">{t('Personnes')}</h1>
        <span className="text-[12px] text-muted">{persons ? plural(named.length + unnamed.length, 'personne', 'personnes') : ''}</span>
        <div className="flex-1" />
        {selected.size > 0 && (
          <div className="no-drag flex items-center gap-2">
            <span className="text-[12.5px]">{tn(selected.size, '{n} sélectionnée', '{n} sélectionnées')}</span>
            <Button variant="primary" className="py-1" disabled={selected.size < 2} onClick={() => void merge()}>
              <Merge className="size-4" /> {t('Fusionner')}
            </Button>
            <Button variant="ghost" className="py-1" onClick={() => {
              const ids = [...selected]
              const anyVisible = list.some((p) => ids.includes(p.id) && !p.hidden)
              void Promise.all(ids.map((id) => mlApi.hidePerson(id, anyVisible))).then(() => setSelected(new Set()))
            }}>
              <EyeOff className="size-4" /> {t('Masquer')}
            </Button>
            <IconButton label={t('Annuler la sélection')} onClick={() => setSelected(new Set())}>
              <X className="size-4" />
            </IconButton>
          </div>
        )}
        <label className="no-drag flex items-center gap-1.5 text-[12px] text-muted">
          <input type="checkbox" className="accent-[var(--accent)]" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} /> {t('Masquées')}
        </label>
      </header>

      {status && !status.enabled && (
        <div className="m-5 rounded-card border border-line bg-surface p-6 text-center">
          <Sparkles className="mx-auto mb-3 size-9 text-accent" strokeWidth={1.5} />
          <h2 className="font-display text-[17px] font-semibold">{t('La reconnaissance des visages est désactivée')}</h2>
          <p className="mx-auto mt-2 max-w-md text-[13px] text-muted">{t('Activez l’intelligence locale dans les réglages. Tout se passe sur cet ordinateur, aucune photo n’est envoyée sur internet.')}</p>
          <Button variant="primary" className="mt-4" onClick={() => useUi.getState().setSettingsOpen(true)}>{t('Ouvrir les réglages')}</Button>
        </div>
      )}
      {status?.enabled && status.pending > 0 && (
        <div className="mx-5 mt-4 flex items-center gap-2 rounded-card bg-hover px-4 py-2.5 text-[12.5px] text-muted">
          <Loader2 className="size-4 animate-spin" /> {tn(status.pending, 'Analyse en cours : {n} élément restant. Les personnes apparaissent au fur et à mesure.', 'Analyse en cours : {n} éléments restants. Les personnes apparaissent au fur et à mesure.')}
        </div>
      )}

      <div className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5 pb-8">
        {isLoading && <Loader2 className="mx-auto mt-10 size-6 animate-spin text-faint" />}
        {status?.enabled && status.pending === 0 && <SamePersonPrompt />}
        {named.length > 0 && (
          <section className="mt-4">
            <div className="mb-1 flex flex-wrap">{named.map((p) => <Card key={p.id} p={p} />)}</div>
          </section>
        )}
        {unnamed.length > 0 && (
          <section className="mt-4">
            <h2 className="mb-1 px-3 text-[12px] font-semibold text-faint">{named.length ? t('À nommer') : t('Double-cliquez sur une personne pour la nommer')}</h2>
            <div className="flex flex-wrap">{unnamed.map((p) => <Card key={p.id} p={p} />)}</div>
          </section>
        )}
        {others.length > 0 && (
          <section className="mt-4">
            <button onClick={() => setShowOthers((v) => !v)} className="mb-1 flex items-center gap-1.5 px-3 text-[12px] font-semibold text-faint hover:text-fg">
              <ChevronRight className={clsx('size-3.5 transition-transform', showOthers && 'rotate-90')} /> {t('Autres visages · {n}', { n: others.length })}
            </button>
            {showOthers && <div className="flex flex-wrap">{others.map((p) => <Card key={p.id} p={p} />)}</div>}
          </section>
        )}
        {persons && list.length === 0 && status?.enabled && status.pending === 0 && (
          <p className="mt-10 text-center text-[13px] text-muted">{t('Aucune personne reconnue pour l’instant.')}</p>
        )}
        {persons && (
          <button onClick={() => setShowAll((v) => !v)} className="mt-6 flex items-center gap-1.5 px-3 text-[12px] text-accent hover:underline">
            <Eye className="size-3.5" /> {showAll ? t('Masquer les personnes vues une seule fois') : t('Afficher les personnes vues une seule fois')}
          </button>
        )}
      </div>
    </div>
  )
}
