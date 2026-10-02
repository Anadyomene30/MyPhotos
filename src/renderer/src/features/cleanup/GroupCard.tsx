import { memo } from 'react'
import clsx from 'clsx'
import { Check, EyeOff, Maximize2, Star, Trash2 } from 'lucide-react'
import { media } from '@/api/client'
import { Button } from '@/components/ui'
import { bytes, duration } from '@/lib/format'
import { localeTag, t } from '@/i18n'
import type { CleanupGroup, CleanupItem } from '@shared/types'

const fmtDate = new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })

function ItemCard({ item, keep, suggested, size, onToggle, showPath }: {
  item: CleanupItem
  keep: boolean
  suggested: boolean
  size: number
  onToggle(): void
  showPath: boolean
}) {
  return (
    <button
      onClick={onToggle}
      className={clsx(
        'group relative shrink-0 overflow-hidden rounded-xl text-left transition-all',
        keep ? 'ring-[3px] ring-emerald-500' : 'opacity-80 ring-1 ring-line hover:opacity-100'
      )}
      style={{ width: size }}
      title={keep ? t('Gardée. Cliquer pour la supprimer') : t('Supprimée. Cliquer pour la garder')}
    >
      <div className="tile-bg relative" style={{ height: size * 0.75 }}>
        <img src={media.thumb(item.id, item.v)} alt="" draggable={false} className={clsx('h-full w-full object-cover transition', !keep && 'grayscale-[40%]')} />
        {suggested && (
          <span className="absolute top-2 left-2 flex items-center gap-1 rounded-full bg-emerald-500 px-2 py-0.5 text-[10.5px] font-semibold text-white shadow">
            <Star className="size-3 fill-white" /> {t('Suggérée')}
          </span>
        )}
        <span className={clsx('absolute top-2 right-2 grid size-6 place-items-center rounded-full shadow', keep ? 'bg-emerald-500 text-white' : 'bg-black/55 text-white')}>
          {keep ? <Check className="size-3.5" strokeWidth={3} /> : <Trash2 className="size-3.5" />}
        </span>
        {item.kind === 'video' && <span className="absolute right-2 bottom-2 rounded bg-black/55 px-1.5 text-[11px] font-semibold text-white">{duration(item.duration)}</span>}
      </div>
      <div className="space-y-0.5 bg-surface px-2.5 py-2 dark:bg-elevated">
        <div className="truncate text-[12px] font-medium">{item.name}</div>
        <div className="truncate text-[11px] text-muted">
          {[item.width && item.height ? `${item.width}×${item.height}` : null, bytes(item.size), item.ext.toUpperCase()].filter(Boolean).join(' · ')}
        </div>
        {showPath ? (
          <div className="truncate text-[11px] text-faint" title={item.relDir}>{item.relDir || '/'}</div>
        ) : (
          <div className="truncate text-[11px] text-faint">{fmtDate.format(item.takenAt)}</div>
        )}
      </div>
    </button>
  )
}

export const GroupCard = memo(function GroupCard({ group, keepIds, onToggle, onApply, onIgnore, onReview, mode }: {
  group: CleanupGroup
  keepIds: Set<number>
  onToggle(id: number): void
  onApply(): void
  onIgnore(): void
  onReview?(): void
  mode: 'exact' | 'visual' | 'similar'
}) {
  const removeCount = group.items.filter((i) => !keepIds.has(i.id)).length
  const removeBytes = group.items.filter((i) => !keepIds.has(i.id)).reduce((a, i) => a + i.size, 0)
  const size = mode === 'similar' ? 188 : 164
  return (
    <div className="rounded-2xl border border-line bg-surface p-4">
      <div className="mb-3 flex items-center gap-3">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">
            {mode === 'similar' ? t('{n} photos très proches', { n: group.items.length }) : mode === 'visual' ? t('{n} versions de la même image', { n: group.items.length }) : t('{n} copies identiques', { n: group.items.length })}
          </div>
          <div className="truncate text-[12px] text-muted">
            <span className="font-medium text-emerald-600 dark:text-emerald-400">{group.reasons.join(' · ')}</span>
          </div>
        </div>
        {onReview && (
          <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={onReview}>
            <Maximize2 className="size-3.5" /> {t('Comparer')}
          </Button>
        )}
        <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={onIgnore} title={t('Ne plus proposer ce groupe')}>
          <EyeOff className="size-3.5" /> {t('Ignorer')}
        </Button>
        <Button variant={removeCount ? 'primary' : 'secondary'} className="py-1 text-[12.5px]" disabled={!removeCount || removeCount === group.items.length} onClick={onApply}>
          {removeCount ? t('Supprimer {n} · {size}', { n: removeCount, size: bytes(removeBytes) }) : t('Tout garder')}
        </Button>
      </div>
      <div className="scroll-thin flex gap-3 overflow-x-auto pb-1">
        {group.items.map((it) => (
          <ItemCard key={it.id} item={it} keep={keepIds.has(it.id)} suggested={it.id === group.keepId} size={size} onToggle={() => onToggle(it.id)} showPath={mode !== 'similar'} />
        ))}
      </div>
    </div>
  )
})
