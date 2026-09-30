import { api, qs } from '@/api/client'
import type { AssetTile, TimelineQuery } from '@shared/types'

const PAGE = 240

export function queryParams(q: TimelineQuery): Record<string, string | number | undefined> {
  return { filter: q.filter, kind: q.kind, year: q.year, album: q.album, person: q.person, category: q.category, place: q.place, search: q.search, similar: q.similar }
}

/**
 * Sparse, paged cache of timeline tiles. The grid knows only counts (from day buckets) and asks
 * for the tiles of visible rows. Stale pages keep rendering until their refresh arrives, so a
 * library change never blanks the screen.
 */
export class TileCache {
  private pages = new Map<number, AssetTile[]>()
  private stale = new Set<number>()
  private loading = new Set<number>()
  private listeners = new Set<() => void>()
  private snapshot = 0
  private lastRange: [number, number] = [0, 0]

  constructor(readonly query: TimelineQuery) {}

  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }

  getSnapshot = (): number => this.snapshot

  private notify(): void {
    this.snapshot++
    for (const l of this.listeners) l()
  }

  get(index: number): AssetTile | undefined {
    return this.pages.get(Math.floor(index / PAGE))?.[index % PAGE]
  }

  ensure(start: number, end: number): void {
    this.lastRange = [start, end]
    const first = Math.floor(Math.max(0, start) / PAGE)
    const last = Math.floor(Math.max(0, end) / PAGE)
    for (let p = first; p <= last; p++) {
      if ((this.pages.has(p) && !this.stale.has(p)) || this.loading.has(p)) continue
      void this.load(p)
    }
  }

  async fetchRange(start: number, end: number): Promise<void> {
    const first = Math.floor(Math.max(0, start) / PAGE)
    const last = Math.floor(Math.max(0, end) / PAGE)
    const jobs: Promise<void>[] = []
    for (let p = first; p <= last; p++) if (!this.pages.has(p) || this.stale.has(p)) jobs.push(this.load(p))
    await Promise.all(jobs)
  }

  private async load(p: number): Promise<void> {
    this.loading.add(p)
    try {
      const q = this.query
      const tiles = await api<AssetTile[]>(`/api/timeline/page${qs({ ...queryParams(q), offset: p * PAGE, limit: PAGE })}`)
      this.pages.set(p, tiles)
      this.stale.delete(p)
      this.notify()
    } catch {
      /* retried on next ensure */
    } finally {
      this.loading.delete(p)
    }
  }

  /** Library changed: mark everything stale and refresh what is on screen. */
  invalidate(): void {
    for (const p of this.pages.keys()) this.stale.add(p)
    this.ensure(...this.lastRange)
  }
}

export const queryKey = (q: TimelineQuery): string => JSON.stringify(queryParams(q))
