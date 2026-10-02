import { useEffect, useRef, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import { Aperture, EyeOff, Loader2, Wand2 } from 'lucide-react'
import { api, media, onServerEvent } from '@/api/client'
import { Button } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { localeTag, t, tn } from '@/i18n'
import { useUi } from '@/store'
import { ignore } from './api'
import type { CleanupGroup } from '@shared/types'

export async function startFusion(ids: number[]): Promise<void> {
  await api('/api/fusion', { method: 'POST', json: { ids } })
}

const fmt = new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' })

export function BracketList({ groups }: { groups: CleanupGroup[] }) {
  const [pending, setPending] = useState<Set<string>>(new Set())
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = groups.filter((g) => !hidden.has(g.key))
  const scrollRef = useRef<HTMLDivElement>(null)
  // a finished fusion (or a failed one) frees its button; a fused series leaves the list when the report refreshes
  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type !== 'creation-done') return
        const key = [...e.sources].sort((a, b) => a - b).join(',')
        setPending((p) => (p.has(key) ? new Set([...p].filter((k) => k !== key)) : p))
      }),
    []
  )
  const v = useVirtualizer({ count: visible.length, getScrollElement: () => scrollRef.current, estimateSize: () => 236, overscan: 3, gap: 12, paddingEnd: 24 })

  const fuse = async (g: CleanupGroup): Promise<void> => {
    setPending((p) => new Set([...p, g.key]))
    try {
      await startFusion(g.items.map((i) => i.id))
    } catch (e) {
      useUi.getState().toast((e as Error).message)
      setPending((p) => new Set([...p].filter((k) => k !== g.key)))
    }
  }

  if (!visible.length) {
    return (
      <div className="grid h-full place-items-center text-center">
        <div>
          <Aperture className="mx-auto mb-3 size-10 text-faint" strokeWidth={1.4} />
          <div className="font-display text-[18px] font-bold">{t('Aucune série de bracketing')}</div>
          <p className="mt-1 max-w-sm text-[13px] text-muted">{t('Les séries de photos prises coup sur coup avec des expositions différentes apparaîtront ici.')}</p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-3 px-5 pb-3">
        <p className="flex-1 text-[12.5px] text-muted">
          {t('Séries prises au même endroit avec des expositions différentes. MyPhotos les aligne et les fusionne en une seule photo bien exposée, sans toucher aux originaux. Le résultat est rangé dans le dossier « MyPhotos Créations ».')}
        </p>
        <Button
          variant="primary"
          className="shrink-0"
          onClick={() =>
            void confirm({ title: tn(visible.length, 'Fusionner {n} série ?', 'Fusionner {n} séries ?'), message: t('Chaque série donnera une nouvelle photo HDR. Les originaux restent intacts.'), confirmLabel: t('Tout fusionner') }).then(async (ok) => {
              if (!ok) return
              for (const g of visible) if (!pending.has(g.key)) await fuse(g)
            })
          }
        >
          <Wand2 className="size-4" /> {t('Tout fusionner')}
        </Button>
      </div>
      <div ref={scrollRef} className="scroll-thin min-h-0 flex-1 overflow-y-auto px-5">
        <div style={{ height: v.getTotalSize(), position: 'relative' }}>
          {v.getVirtualItems().map((it) => {
            const g = visible[it.index]!
            const busy = pending.has(g.key)
            return (
              <div key={g.key} ref={v.measureElement} data-index={it.index} style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${it.start}px)` }}>
                <div className="rounded-card border border-line bg-surface p-4">
                  <div className="mb-3 flex items-center gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] font-bold">{g.reasons[0]}</div>
                      <div className="truncate text-[12px] text-muted">{[fmt.format(g.items[0]!.takenAt), g.reasons[1]].filter(Boolean).join(' · ')}</div>
                    </div>
                    <Button variant="ghost" className="px-2 py-1 text-[12px]" onClick={() => {
                      void ignore(g.key, 'brackets')
                      setHidden((h) => new Set([...h, g.key]))
                    }}>
                      <EyeOff className="size-3.5" /> {t('Ignorer')}
                    </Button>
                    <Button variant="primary" className="py-1 text-[12.5px]" disabled={busy} onClick={() => void fuse(g)}>
                      {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
                      {busy ? t('Fusion…') : t('Créer la photo HDR')}
                    </Button>
                  </div>
                  <div className="scroll-thin flex gap-2 overflow-x-auto pb-1">
                    {g.items.map((i) => (
                      <div key={i.id} className="tile-bg relative h-[140px] shrink-0 overflow-hidden rounded-lg" style={{ width: 140 * ((i.width ?? 3) / (i.height ?? 2)) }}>
                        <img src={media.thumb(i.id, i.v)} alt="" className="h-full w-full object-cover" draggable={false} />
                        <span className="absolute bottom-1.5 left-1.5 rounded bg-black/55 px-1.5 py-0.5 text-[10.5px] font-bold text-white">{i.name}</span>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
