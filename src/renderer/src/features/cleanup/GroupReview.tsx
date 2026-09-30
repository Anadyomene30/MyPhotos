import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { Check, ChevronLeft, ChevronRight, Columns2, Star, Trash2, X } from 'lucide-react'
import { media } from '@/api/client'
import { Button, IconButton } from '@/components/ui'
import type { CleanupGroup } from '@shared/types'

/** Full-screen comparison of a group: large previews side by side, keyboard to keep or discard. */
export function GroupReview({ group, keepIds, onToggle, onClose, onApply }: {
  group: CleanupGroup
  keepIds: Set<number>
  onToggle(id: number): void
  onClose(): void
  onApply(): void
}) {
  const [focus, setFocus] = useState(0)
  const [sideBySide, setSideBySide] = useState(true)
  const items = group.items
  const cur = items[focus]!
  const suggested = items.find((i) => i.id === group.keepId)!
  const shown = sideBySide && cur.id !== suggested.id ? [suggested, cur] : [cur]

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      else if (e.key === 'ArrowRight') setFocus((f) => Math.min(items.length - 1, f + 1))
      else if (e.key === 'ArrowLeft') setFocus((f) => Math.max(0, f - 1))
      else if (e.key === ' ' || e.key === 'k' || e.key === 'K') onToggle(items[focus]!.id)
      else if (e.key === 'Enter') onApply()
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [items, focus, onClose, onToggle, onApply])

  const removeCount = items.filter((i) => !keepIds.has(i.id)).length
  return (
    <div className="animate-fade-in fixed inset-0 z-50 flex flex-col bg-[#0b0b0c] text-white">
      <div className="drag flex h-[52px] shrink-0 items-center gap-3 pr-4 pl-[84px]">
        <div className="min-w-0 flex-1 text-[13px]">
          <span className="font-semibold">{items.length} photos</span>
          <span className="ml-2 text-emerald-400">{group.reasons.join(' · ')}</span>
        </div>
        <div className="no-drag flex items-center gap-1 [&_button]:text-white/80 [&_button:hover]:bg-white/10">
          <IconButton label="Côte à côte avec la suggestion" active={sideBySide} onClick={() => setSideBySide((v) => !v)}>
            <Columns2 className="size-[18px]" />
          </IconButton>
          <IconButton label="Fermer (Échap)" onClick={onClose}>
            <X className="size-[18px]" />
          </IconButton>
        </div>
        <Button variant="primary" className="no-drag" disabled={!removeCount || removeCount === items.length} onClick={onApply}>
          Supprimer {removeCount} (Entrée)
        </Button>
      </div>
      <div className={clsx('relative grid min-h-0 flex-1 grid-rows-1 gap-3 px-4', shown.length === 2 ? 'grid-cols-2' : 'grid-cols-1')}>
        {shown.map((it) => (
          <div key={it.id} className="relative h-full min-h-0 overflow-hidden">
            <img src={media.preview(it.id, it.v)} alt="" className="absolute inset-0 h-full w-full object-contain" draggable={false} />
            <div className="absolute top-3 left-3 flex gap-2">
              {it.id === group.keepId && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-500 px-2.5 py-1 text-[11.5px] font-semibold shadow"><Star className="size-3 fill-white" /> Suggérée</span>
              )}
              <span className={clsx('rounded-full px-2.5 py-1 text-[11.5px] font-semibold shadow', keepIds.has(it.id) ? 'bg-white/90 text-black' : 'bg-red-500 text-white')}>
                {keepIds.has(it.id) ? 'Gardée' : 'Supprimée'}
              </span>
            </div>
          </div>
        ))}
        <button className="absolute top-1/2 left-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40" onClick={() => setFocus((f) => Math.max(0, f - 1))} aria-label="Précédente">
          <ChevronLeft className="size-5" />
        </button>
        <button className="absolute top-1/2 right-2 grid size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40" onClick={() => setFocus((f) => Math.min(items.length - 1, f + 1))} aria-label="Suivante">
          <ChevronRight className="size-5" />
        </button>
      </div>
      <div className="flex shrink-0 justify-center gap-2 overflow-x-auto px-4 py-3">
        {items.map((it, i) => (
          <button
            key={it.id}
            onClick={() => setFocus(i)}
            onDoubleClick={() => onToggle(it.id)}
            className={clsx('relative size-16 shrink-0 overflow-hidden rounded-lg transition', i === focus ? 'ring-2 ring-white' : 'opacity-60 hover:opacity-100')}
          >
            <img src={media.thumb(it.id, it.v)} alt="" className="h-full w-full object-cover" draggable={false} />
            <span className={clsx('absolute right-1 bottom-1 grid size-4 place-items-center rounded-full', keepIds.has(it.id) ? 'bg-emerald-500' : 'bg-red-500')}>
              {keepIds.has(it.id) ? <Check className="size-2.5" strokeWidth={3} /> : <Trash2 className="size-2.5" />}
            </span>
          </button>
        ))}
      </div>
      <p className="pb-3 text-center text-[11.5px] text-white/45">← → pour parcourir · Espace pour garder ou supprimer · Entrée pour appliquer</p>
    </div>
  )
}
