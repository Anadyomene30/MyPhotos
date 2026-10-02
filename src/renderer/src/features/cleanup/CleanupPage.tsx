import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Aperture, Copy, Layers, Loader2, Sparkles, Trash2 } from 'lucide-react'
import { BracketList } from './BracketList'
import { media } from '@/api/client'
import { Button } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { bytes, count, plural } from '@/lib/format'
import { t, tn } from '@/i18n'
import { useCleanupReport, ignore, resolveExact, trashIds } from './api'
import { GroupCard } from './GroupCard'
import { GroupReview } from './GroupReview'
import type { CleanupGroup, CleanupReport, SuggestionCategory } from '@shared/types'

type Tab = 'brackets' | 'exact' | 'visual' | 'similar' | 'suggestions'

export function CleanupPage() {
  const { data: report, isLoading } = useCleanupReport()
  const [tab, setTab] = useState<Tab | null>(null)
  const active: Tab = tab ?? (report ? (report.exact.length ? 'exact' : report.visual.length ? 'visual' : report.similar.length ? 'similar' : 'suggestions') : 'exact')
  const win = window.desktop && window.desktop.platform !== 'darwin'

  return (
    <div className="flex h-full flex-col">
      <header className={clsx('drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line pl-5', win ? 'pr-[150px]' : 'pr-4')}>
        <h1 className="etiquette">{t('Nettoyage')}</h1>
        {report && report.analyzed < report.total && (
          <span className="flex items-center gap-1.5 text-[12px] text-muted">
            <Loader2 className="size-3.5 animate-spin" /> {t('Analyse en cours · {done} / {total}', { done: count(report.analyzed), total: count(report.total) })}
          </span>
        )}
      </header>
      {isLoading || !report ? (
        <div className="grid flex-1 place-items-center">
          <Loader2 className="size-6 animate-spin text-faint" />
        </div>
      ) : (
        <>
          <SummaryCards report={report} active={active} onSelect={setTab} />
          <div className="min-h-0 flex-1">
            {active === 'suggestions' ? (
              <Suggestions categories={report.suggestions} />
            ) : active === 'brackets' ? (
              <BracketList groups={report.brackets} />
            ) : (
              <GroupList key={active} mode={active} groups={report[active]} />
            )}
          </div>
        </>
      )}
    </div>
  )
}

function SummaryCards({ report, active, onSelect }: { report: CleanupReport; active: Tab; onSelect(t: Tab): void }) {
  const sum = (gs: CleanupGroup[]): number => gs.reduce((a, g) => a + g.reclaimable, 0)
  const sugBytes = report.suggestions.reduce((a, c) => a + c.bytes, 0)
  const sugCount = report.suggestions.reduce((a, c) => a + c.items.length, 0)
  const cards: Array<{ id: Tab; icon: React.ReactNode; title: string; value: string; sub: string }> = [
    { id: 'brackets', icon: <Aperture className="size-4" />, title: t('Bracketing'), value: count(report.brackets.length), sub: report.brackets.length ? t('séries à fusionner en HDR') : t('Aucune série') },
    { id: 'exact', icon: <Copy className="size-4" />, title: t('Doublons exacts'), value: count(report.exact.length), sub: report.exact.length ? t('{size} récupérables', { size: bytes(sum(report.exact)) }) : t('Aucun fichier en double') },
    { id: 'visual', icon: <Layers className="size-4" />, title: t('Mêmes images'), value: count(report.visual.length), sub: report.visual.length ? t('autre format ou taille · {size}', { size: bytes(sum(report.visual)) }) : t('Aucune version en double') },
    { id: 'similar', icon: <Sparkles className="size-4" />, title: t('Photos similaires'), value: count(report.similar.length), sub: report.similar.length ? t('rafales : garder la meilleure') : t('Aucune rafale') },
    { id: 'suggestions', icon: <Trash2 className="size-4" />, title: t('À trier'), value: count(sugCount), sub: sugCount ? t('{size} au total', { size: bytes(sugBytes) }) : t('Rien à signaler') }
  ]
  return (
    <div className="grid shrink-0 grid-cols-5 gap-3 px-5 pt-4 pb-3">
      {cards.map((c) => (
        <button
          key={c.id}
          onClick={() => onSelect(c.id)}
          className={clsx('rounded-card border px-4 py-3 text-left transition-colors', active === c.id ? 'border-accent bg-accent-soft' : 'border-line hover:bg-hover')}
        >
          <div className={clsx('flex items-center gap-2 text-[12.5px] font-medium', active === c.id ? 'text-accent' : 'text-muted')}>
            {c.icon}
            {c.title}
          </div>
          <div className="mt-1 font-display text-[26px] leading-tight font-bold tabular-nums">{c.value}</div>
          <div className="truncate text-[11.5px] text-muted">{c.sub}</div>
        </button>
      ))}
    </div>
  )
}

/** Initial keep decision: exact/visual keep only the suggestion, similar keep only the suggestion too. */
function defaultKeeps(groups: CleanupGroup[]): Map<string, Set<number>> {
  return new Map(groups.map((g) => [g.key, new Set([g.keepId, ...g.items.filter((i) => i.favorite).map((i) => i.id)])]))
}

function GroupList({ mode, groups }: { mode: 'exact' | 'visual' | 'similar'; groups: CleanupGroup[] }) {
  const [keeps, setKeeps] = useState(() => defaultKeeps(groups))
  const [done, setDone] = useState<Set<string>>(new Set())
  const [review, setReview] = useState<CleanupGroup | null>(null)
  useEffect(() => {
    setKeeps((prev) => {
      const next = defaultKeeps(groups)
      for (const [k, v] of prev) if (next.has(k)) next.set(k, v)
      return next
    })
  }, [groups])
  const visible = useMemo(() => groups.filter((g) => !done.has(g.key)), [groups, done])
  const scrollRef = useRef<HTMLDivElement>(null)
  const virtualizer = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => (mode === 'similar' ? 300 : 272), overscan: 3, gap: 12, paddingStart: 4, paddingEnd: 24 })

  const toggle = useCallback((key: string, id: number) => {
    setKeeps((prev) => {
      const next = new Map(prev)
      const set = new Set(next.get(key))
      if (mode === 'similar') {
        if (set.has(id)) set.delete(id)
        else set.add(id)
      } else {
        set.clear()
        set.add(id)
      }
      next.set(key, set)
      return next
    })
  }, [mode])

  const apply = async (gs: CleanupGroup[]): Promise<void> => {
    const plan = gs.map((g) => {
      const keep = keeps.get(g.key) ?? new Set([g.keepId])
      return { g, keep, remove: g.items.filter((i) => !keep.has(i.id)).map((i) => i.id) }
    }).filter((p) => p.remove.length && p.keep.size)
    if (!plan.length) return
    if (mode === 'exact') await resolveExact(plan.map((p) => ({ keep: [...p.keep][0]!, remove: p.remove })))
    else await trashIds(plan.flatMap((p) => p.remove))
    setDone((d) => new Set([...d, ...plan.map((p) => p.g.key)]))
  }

  const applyAll = async (): Promise<void> => {
    const removeCount = visible.reduce((a, g) => a + g.items.filter((i) => !(keeps.get(g.key) ?? new Set()).has(i.id)).length, 0)
    const removeBytes = visible.reduce((a, g) => a + g.items.filter((i) => !(keeps.get(g.key) ?? new Set()).has(i.id)).reduce((s, i) => s + i.size, 0), 0)
    const ok = await confirm({
      title: t('Appliquer toutes les suggestions ?'),
      message:
        tn(removeCount, '{n} élément sera placé dans la corbeille de MyPhotos ({size}). Vous pourrez le restaurer pendant 30 jours.', '{n} éléments seront placés dans la corbeille de MyPhotos ({size}). Vous pourrez les restaurer pendant 30 jours.', { size: bytes(removeBytes) }) +
        (mode === 'exact' ? ' ' + t('Chaque copie est vérifiée octet par octet avant suppression.') : ''),
      confirmLabel: t('Tout appliquer')
    })
    if (ok) await apply(visible)
  }

  if (!visible.length) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div className="animate-fade-in">
          <Sparkles className="mx-auto mb-3 size-10 text-emerald-500" strokeWidth={1.4} />
          <div className="font-display text-[18px] font-semibold">{t('Tout est propre ici')}</div>
          <p className="mt-1 text-[13px] text-muted">{mode === 'similar' ? t('Aucune rafale à trier.') : t('Aucun doublon détecté.')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 pb-3">
        <p className="flex-1 text-[12.5px] text-muted">
          {mode === 'exact' && t('Fichiers strictement identiques. La copie suggérée est celle qui n’est pas dans un dossier de copies. Cliquez sur une autre pour la garder à sa place.')}
          {mode === 'visual' && t('La même image en plusieurs fichiers (autre format, taille réduite, version retouchée). La suggestion garde la meilleure définition.')}
          {mode === 'similar' && t('Photos prises à quelques secondes d’intervalle. La plus nette et la mieux exposée est suggérée. Cliquez pour garder ou supprimer chaque photo.')}
        </p>
        <Button variant="primary" className="shrink-0" onClick={() => void applyAll()}>
          {tn(visible.length, 'Tout appliquer ({n} groupe)', 'Tout appliquer ({n} groupes)')}
        </Button>
      </div>
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5">
        <div style={{ height: virtualizer.getTotalSize(), position: 'relative' }}>
          {virtualizer.getVirtualItems().map((it) => {
            const g = visible[it.index]!
            return (
              <div key={g.key} ref={virtualizer.measureElement} data-index={it.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${it.start}px)` }}>
                <GroupCard
                  group={g}
                  mode={mode}
                  keepIds={keeps.get(g.key) ?? new Set()}
                  onToggle={(id) => toggle(g.key, id)}
                  onApply={() => void apply([g])}
                  onIgnore={() => {
                    void ignore(g.key, mode)
                    setDone((d) => new Set([...d, g.key]))
                  }}
                  onReview={mode !== 'exact' ? () => setReview(g) : undefined}
                />
              </div>
            )
          })}
        </div>
      </div>
      {review && (
        <GroupReview
          group={review}
          keepIds={keeps.get(review.key) ?? new Set()}
          onToggle={(id) => toggle(review.key, id)}
          onClose={() => setReview(null)}
          onApply={() => {
            void apply([review])
            setReview(null)
          }}
        />
      )}
    </div>
  )
}

function Suggestions({ categories }: { categories: SuggestionCategory[] }) {
  const [cat, setCat] = useState(categories[0]?.id ?? null)
  const current = categories.find((c) => c.id === cat) ?? categories[0]
  const [checked, setChecked] = useState<Set<number>>(new Set())
  const [removed, setRemoved] = useState<Set<number>>(new Set())
  useEffect(() => setChecked(new Set(current?.items.map((i) => i.id) ?? [])), [current?.id])
  if (!current) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <Sparkles className="mx-auto mb-3 size-10 text-emerald-500" strokeWidth={1.4} />
          <div className="font-display text-[18px] font-semibold">{t('Rien à trier')}</div>
        </div>
      </div>
    )
  }
  const items = current.items.filter((i) => !removed.has(i.id))
  const selected = items.filter((i) => checked.has(i.id))
  return (
    <div className="flex h-full gap-4 px-5 pb-4">
      <div className="w-60 shrink-0 space-y-1">
        {categories.map((c) => (
          <button key={c.id} onClick={() => setCat(c.id)} className={clsx('w-full rounded-card px-3 py-2 text-left transition-colors', c.id === current.id ? 'bg-accent-soft' : 'hover:bg-hover')}>
            <div className="text-[13px] font-medium">{c.title}</div>
            <div className="text-[11.5px] text-muted">{plural(c.items.length, 'élément', 'éléments')} · {bytes(c.bytes)}</div>
          </button>
        ))}
      </div>
      <div className="flex min-w-0 flex-1 flex-col rounded-card border border-line bg-surface">
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="text-[13px] font-semibold">{current.title}</div>
            <div className="truncate text-[12px] text-muted">{current.description}</div>
          </div>
          <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={() => setChecked(checked.size === items.length ? new Set() : new Set(items.map((i) => i.id)))}>
            {checked.size === items.length ? t('Tout décocher') : t('Tout cocher')}
          </Button>
          {current.id !== 'largeVideos' && (
            <Button variant="ghost" className="px-2 py-1 text-[12px]" disabled={!selected.length} onClick={() => {
              for (const i of selected) void ignore(`item:${i.id}`, current.id)
              setRemoved(new Set([...removed, ...selected.map((i) => i.id)]))
            }}>
              {t('Ne plus proposer')}
            </Button>
          )}
          <Button variant="primary" disabled={!selected.length} onClick={() => {
            const ids = selected.map((i) => i.id)
            void trashIds(ids).then(() => setRemoved(new Set([...removed, ...ids])))
          }}>
            {selected.length ? t('Supprimer {n} · {size}', { n: count(selected.length), size: bytes(selected.reduce((a, i) => a + i.size, 0)) }) : t('Supprimer')}
          </Button>
        </div>
        <div className="scroll-thin grid min-h-0 flex-1 grid-cols-[repeat(auto-fill,minmax(130px,1fr))] content-start gap-2 overflow-y-auto p-3">
          {items.map((i) => (
            <button
              key={i.id}
              onClick={() => {
                const next = new Set(checked)
                if (next.has(i.id)) next.delete(i.id)
                else next.add(i.id)
                setChecked(next)
              }}
              className={clsx('tile-bg relative aspect-square overflow-hidden rounded-lg transition', checked.has(i.id) ? 'ring-[3px] ring-accent' : 'opacity-60 hover:opacity-100')}
              title={`${i.name} · ${bytes(i.size)}`}
            >
              <img src={media.thumb(i.id, i.v)} alt="" className="h-full w-full object-cover" draggable={false} />
              {i.kind === 'video' && <span className="absolute right-1.5 bottom-1.5 rounded bg-black/55 px-1 text-[10.5px] font-semibold text-white">{bytes(i.size)}</span>}
              {checked.has(i.id) && (
                <span className="absolute top-1.5 right-1.5 grid size-5 place-items-center rounded-full bg-accent text-on-accent ring-2 ring-white">
                  <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4}><path d="M3.5 8.5l3 3 6-7" /></svg>
                </span>
              )}
            </button>
          ))}
        </div>
      </div>
    </div>
  )
}
