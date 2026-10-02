import { useMemo } from 'react'
import type { Group } from './layout'
import type { Grouping } from '@/store'

/** Vertical list of years on the right edge; jumps to the first group of the year. */
export function YearScrubber({ groups, grouping, onJump }: { groups: Group[]; grouping: Grouping; onJump(groupIndex: number): void }) {
  const years = useMemo(() => {
    const out: Array<{ year: string; group: number }> = []
    groups.forEach((g, i) => {
      const y = g.key.slice(0, 4)
      if (/^\d{4}$/.test(y) && out[out.length - 1]?.year !== y) out.push({ year: y, group: i })
    })
    return out
  }, [groups])
  if (years.length < 2 || grouping === 'year') return null
  return (
    <div className="group/scrub absolute top-16 right-1 bottom-6 flex w-12 flex-col items-end justify-center">
      <div className="flex flex-col items-end gap-0.5 rounded-card border border-transparent px-1.5 py-2 opacity-0 transition-opacity group-hover/scrub:border-line group-hover/scrub:bg-panel group-hover/scrub:opacity-100">
        {years.map((y) => (
          <button
            key={y.year}
            onClick={() => onJump(y.group)}
            className="rounded-card px-1.5 py-0.5 text-[11px] font-semibold text-muted tabular-nums hover:bg-hover hover:text-fg"
          >
            {y.year}
          </button>
        ))}
      </div>
    </div>
  )
}
