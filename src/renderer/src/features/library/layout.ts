import type { DayBucket } from '@shared/types'
import type { Grouping } from '@/store'

export interface Group {
  key: string
  start: number
  count: number
}

export type LayoutRow =
  | { type: 'header'; group: number; top: number; height: number }
  | { type: 'tiles'; group: number; start: number; count: number; top: number; height: number }

export interface Layout {
  groups: Group[]
  rows: LayoutRow[]
  columns: number
  cell: number
  gap: number
  total: number
  height: number
}

export const HEADER_HEIGHT: Record<Grouping, number> = { day: 58, month: 74, year: 96 }
export const GAP = 2
export const SIDE_PADDING = 20

export function groupKey(day: string, grouping: Grouping): string {
  if (day === 'unknown') return day
  return grouping === 'day' ? day : grouping === 'month' ? day.slice(0, 7) : day.slice(0, 4)
}

export function groupBuckets(buckets: DayBucket[], grouping: Grouping): Group[] {
  const groups: Group[] = []
  let start = 0
  for (const b of buckets) {
    const key = groupKey(b.day, grouping)
    const last = groups[groups.length - 1]
    if (last && last.key === key) last.count += b.count
    else groups.push({ key, start, count: b.count })
    start += b.count
  }
  return groups
}

/** Pure layout: turns day buckets into header + tile rows for a virtualized list. */
export function buildLayout(buckets: DayBucket[], grouping: Grouping, width: number, targetCell: number): Layout {
  const inner = Math.max(100, width - SIDE_PADDING * 2)
  const columns = Math.max(1, Math.round((inner + GAP) / (targetCell + GAP)))
  const cell = (inner - GAP * (columns - 1)) / columns
  const groups = groupBuckets(buckets, grouping)
  const rows: LayoutRow[] = []
  let top = 0
  const headerH = HEADER_HEIGHT[grouping]
  groups.forEach((g, gi) => {
    rows.push({ type: 'header', group: gi, top, height: headerH })
    top += headerH
    for (let i = 0; i < g.count; i += columns) {
      const n = Math.min(columns, g.count - i)
      rows.push({ type: 'tiles', group: gi, start: g.start + i, count: n, top, height: cell + GAP })
      top += cell + GAP
    }
  })
  const total = groups.reduce((a, g) => a + g.count, 0)
  return { groups, rows, columns, cell, gap: GAP, total, height: top }
}

/** Row index containing a global asset index (binary search; header rows sort just before their first tile). */
export function rowOfIndex(layout: Layout, index: number): number {
  const key = (r: LayoutRow): number => (r.type === 'tiles' ? r.start : layout.groups[r.group]!.start - 0.5)
  let lo = 0
  let hi = layout.rows.length - 1
  let best = 0
  while (lo <= hi) {
    const mid = (lo + hi) >> 1
    if (key(layout.rows[mid]!) <= index) {
      best = mid
      lo = mid + 1
    } else hi = mid - 1
  }
  return best
}
