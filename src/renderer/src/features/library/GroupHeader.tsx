import { memo } from 'react'
import { dayLabel, monthLabel, plural } from '@/lib/format'
import { SIDE_PADDING, type Group } from './layout'
import type { Grouping } from '@/store'

export function groupTitle(key: string, grouping: Grouping): string {
  if (key === 'unknown') return 'Date inconnue'
  if (grouping === 'year') return key
  if (grouping === 'month') return monthLabel(key)
  return dayLabel(key).title
}

export const GroupHeader = memo(function GroupHeader({ group, grouping }: { group: Group; grouping: Grouping }) {
  const n = plural(group.count, 'élément', 'éléments')
  if (grouping === 'year') {
    return (
      <div className="flex h-full items-end justify-between pb-3" style={{ paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}>
        <h2 className="font-display text-[40px] leading-none font-bold tracking-tight">{groupTitle(group.key, grouping)}</h2>
        <span className="pb-1 text-[13px] text-muted">{n}</span>
      </div>
    )
  }
  if (grouping === 'month') {
    return (
      <div className="flex h-full items-end justify-between pb-2.5" style={{ paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}>
        <h2 className="font-display text-[26px] leading-none font-bold tracking-tight">{groupTitle(group.key, grouping)}</h2>
        <span className="text-[12px] text-muted">{n}</span>
      </div>
    )
  }
  const d = group.key === 'unknown' ? { title: 'Date inconnue', sub: '' } : dayLabel(group.key)
  return (
    <div className="flex h-full items-end justify-between pb-2" style={{ paddingLeft: SIDE_PADDING, paddingRight: SIDE_PADDING }}>
      <div className="flex items-baseline gap-2.5">
        <h2 className="font-display text-[19px] leading-none font-semibold tracking-tight">{d.title}</h2>
        <span className="text-[13px] text-muted">{d.sub}</span>
      </div>
      <span className="text-[12px] text-faint">{n}</span>
    </div>
  )
})
