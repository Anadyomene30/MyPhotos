import type { Db, Row } from '../db'
import { StatementCache } from '../db'
import { isWebNative } from '../media/kinds'
import type { AssetDetail, AssetKind, AssetTile, DayBucket, LibraryCounts, LibraryFilter, TimelineQuery } from '@shared/types'

const VISIBLE = 'hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL'
const ORDER = 'day DESC, taken_at DESC, id DESC'

export function filterWhere(q: TimelineQuery, albumCond?: { sql: string; params: Array<string | number> }): { sql: string; params: Array<string | number> } {
  const parts: string[] = []
  const params: Array<string | number> = []
  const f: LibraryFilter = q.filter
  if (f === 'trash') parts.push('hidden = 0 AND missing_at IS NULL AND trashed_at IS NOT NULL')
  else parts.push(VISIBLE)
  if (f === 'photos') parts.push("kind = 'photo'")
  if (f === 'videos') parts.push("kind = 'video'")
  if (f === 'live') parts.push('is_live = 1')
  if (f === 'screenshots') parts.push('is_screenshot = 1')
  if (f === 'favorites') parts.push('favorite = 1')
  if (f === 'raw') parts.push('is_raw = 1')
  if (q.kind === 'photo') parts.push("kind = 'photo'")
  if (q.kind === 'video') parts.push("kind = 'video'")
  if (q.year) {
    parts.push('day >= ? AND day <= ?')
    params.push(`${q.year}-01-01`, `${q.year}-12-31`)
  }
  if (albumCond) {
    parts.push(`(${albumCond.sql})`)
    params.push(...albumCond.params)
  }
  return { sql: parts.join(' AND '), params }
}

/** Pin the ordered partial indexes: the planner otherwise prefers the counts index and sorts 200k rows. */
function orderedFrom(q: TimelineQuery): string {
  if (q.filter === 'trash') return 'assets'
  return q.kind === 'photo' || q.kind === 'video' ? 'assets INDEXED BY assets_kind_timeline' : 'assets INDEXED BY assets_timeline'
}

const TILE_COLS = 'id, kind, ratio, taken_at, duration, is_live, favorite, is_raw, thumb_v, qhash'

/** Thumbnail cache key: content fingerprint + regeneration counter, so a reused id never shows a stale image. */
export function thumbKey(r: Row): string {
  return `${String(r.qhash ?? 'x').slice(0, 10)}${r.thumb_v as number}`
}

export function toTile(r: Row): AssetTile {
  return {
    id: r.id as number,
    kind: r.kind as AssetKind,
    ratio: (r.ratio as number | null) ?? 1,
    takenAt: r.taken_at as number,
    duration: (r.duration as number | null) ?? null,
    live: r.is_live === 1,
    favorite: r.favorite === 1,
    raw: r.is_raw === 1,
    v: thumbKey(r)
  }
}

export class AssetRepo {
  private stmts: StatementCache
  /** resolves an album id to its SQL condition (set by the library) */
  albumCondition: ((id: number) => { sql: string; params: Array<string | number> }) | null = null

  constructor(private db: Db) {
    this.stmts = new StatementCache(db)
  }

  private where(q: TimelineQuery): { sql: string; params: Array<string | number> } {
    return filterWhere(q, q.album && this.albumCondition ? this.albumCondition(q.album) : undefined)
  }

  buckets(q: TimelineQuery): DayBucket[] {
    const w = this.where(q)
    return this.stmts
      .get(`SELECT day, count(*) AS count FROM ${orderedFrom(q)} WHERE ${w.sql} GROUP BY day ORDER BY day DESC`)
      .all(...w.params) as unknown as DayBucket[]
  }

  page(q: TimelineQuery, offset: number, limit: number): AssetTile[] {
    const w = this.where(q)
    const rows = this.stmts
      .get(`SELECT ${TILE_COLS} FROM ${orderedFrom(q)} WHERE ${w.sql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`)
      .all(...w.params, limit, offset) as Row[]
    return rows.map(toTile)
  }

  ids(q: TimelineQuery): number[] {
    const w = this.where(q)
    return (this.stmts.get(`SELECT id FROM ${orderedFrom(q)} WHERE ${w.sql} ORDER BY ${ORDER}`).all(...w.params) as Array<{ id: number }>).map((r) => r.id)
  }

  /** Position of an asset inside a filtered timeline, used to open the viewer at the right index. */
  indexOf(q: TimelineQuery, id: number): number | null {
    const row = this.stmts.get('SELECT day, taken_at FROM assets WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    const w = this.where(q)
    const r = this.stmts
      .get(`SELECT count(*) AS n FROM ${orderedFrom(q)} WHERE ${w.sql} AND (day > ? OR (day = ? AND (taken_at > ? OR (taken_at = ? AND id > ?))))`)
      .get(...w.params, row.day as string, row.day as string, row.taken_at as number, row.taken_at as number, id) as { n: number }
    return r.n
  }

  counts(): LibraryCounts {
    // Index-only scan of the partial counts index, plus the small trash index.
    const rows = this.stmts
      .get(`SELECT kind, is_live, is_screenshot, favorite, is_raw, count(*) AS n
        FROM assets INDEXED BY assets_counts WHERE ${VISIBLE}
        GROUP BY kind, is_live, is_screenshot, favorite, is_raw`)
      .all() as Array<{ kind: string; is_live: number; is_screenshot: number; favorite: number; is_raw: number; n: number }>
    const trash = this.stmts.get('SELECT count(*) AS n FROM assets WHERE trashed_at IS NOT NULL AND hidden = 0 AND missing_at IS NULL').get() as { n: number }
    const c: LibraryCounts = { all: 0, photos: 0, videos: 0, live: 0, screenshots: 0, favorites: 0, raw: 0, trash: trash.n }
    for (const r of rows) {
      c.all += r.n
      if (r.kind === 'photo') c.photos += r.n
      else c.videos += r.n
      if (r.is_live) c.live += r.n
      if (r.is_screenshot) c.screenshots += r.n
      if (r.favorite) c.favorites += r.n
      if (r.is_raw) c.raw += r.n
    }
    return c
  }

  years(): Array<{ year: number; count: number }> {
    return this.stmts
      .get(`SELECT CAST(substr(day, 1, 4) AS INTEGER) AS year, count(*) AS count FROM assets WHERE ${VISIBLE} GROUP BY 1 ORDER BY 1 DESC`)
      .all() as unknown as Array<{ year: number; count: number }>
  }

  raw(id: number): Row | undefined {
    return this.stmts.get('SELECT * FROM assets WHERE id = ?').get(id) as Row | undefined
  }

  detail(id: number): AssetDetail | null {
    const r = this.raw(id)
    if (!r) return null
    const kind = r.kind as AssetKind
    const ext = r.ext as string
    return {
      ...toTile(r),
      path: r.path as string,
      name: r.name as string,
      ext,
      size: r.size as number,
      width: r.width as number | null,
      height: r.height as number | null,
      day: r.day as string | null,
      tzOffset: r.tz_offset as number | null,
      lat: r.lat as number | null,
      lon: r.lon as number | null,
      make: r.make as string | null,
      model: r.model as string | null,
      lens: r.lens as string | null,
      iso: r.iso as number | null,
      fnumber: r.fnumber as number | null,
      exposure: r.exposure as number | null,
      focal: r.focal as number | null,
      screenshot: r.is_screenshot === 1,
      rating: r.rating as number,
      hasLiveVideo: Boolean(r.live_video),
      rawCompanion: (r.raw_companion as string | null) ?? null,
      webNative: isWebNative(kind, ext),
      trashedAt: r.trashed_at as number | null
    }
  }

  setFavorite(ids: number[], favorite: boolean): void {
    const stmt = this.stmts.get('UPDATE assets SET favorite = ? WHERE id = ?')
    for (const id of ids) stmt.run(favorite ? 1 : 0, id)
  }

  setTrashed(ids: number[], trashed: boolean): void {
    const stmt = this.stmts.get('UPDATE assets SET trashed_at = ? WHERE id = ?')
    const now = trashed ? Date.now() : null
    for (const id of ids) stmt.run(now, id)
  }
}
