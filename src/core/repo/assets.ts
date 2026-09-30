import type { Db, Row } from '../db'
import { StatementCache } from '../db'
import { isWebNative } from '../media/kinds'
import type { AssetDetail, AssetKind, AssetTile, DayBucket, LibraryCounts, LibraryFilter, TimelineQuery } from '@shared/types'

const VISIBLE = 'hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL'
const ORDER = 'day DESC, taken_at DESC, id DESC'

export function filterWhere(q: TimelineQuery): { sql: string; params: Array<string | number> } {
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
  return { sql: parts.join(' AND '), params }
}

const TILE_COLS = 'id, kind, ratio, taken_at, duration, is_live, favorite, is_raw, thumb_v'

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
    v: r.thumb_v as number
  }
}

export class AssetRepo {
  private stmts: StatementCache
  constructor(private db: Db) {
    this.stmts = new StatementCache(db)
  }

  buckets(q: TimelineQuery): DayBucket[] {
    const w = filterWhere(q)
    return this.stmts
      .get(`SELECT day, count(*) AS count FROM assets WHERE ${w.sql} GROUP BY day ORDER BY day DESC`)
      .all(...w.params) as unknown as DayBucket[]
  }

  page(q: TimelineQuery, offset: number, limit: number): AssetTile[] {
    const w = filterWhere(q)
    const rows = this.stmts
      .get(`SELECT ${TILE_COLS} FROM assets WHERE ${w.sql} ORDER BY ${ORDER} LIMIT ? OFFSET ?`)
      .all(...w.params, limit, offset) as Row[]
    return rows.map(toTile)
  }

  ids(q: TimelineQuery): number[] {
    const w = filterWhere(q)
    return (this.stmts.get(`SELECT id FROM assets WHERE ${w.sql} ORDER BY ${ORDER}`).all(...w.params) as Array<{ id: number }>).map((r) => r.id)
  }

  /** Position of an asset inside a filtered timeline, used to open the viewer at the right index. */
  indexOf(q: TimelineQuery, id: number): number | null {
    const row = this.stmts.get('SELECT day, taken_at FROM assets WHERE id = ?').get(id) as Row | undefined
    if (!row) return null
    const w = filterWhere(q)
    const r = this.stmts
      .get(`SELECT count(*) AS n FROM assets WHERE ${w.sql} AND (day > ? OR (day = ? AND (taken_at > ? OR (taken_at = ? AND id > ?))))`)
      .get(...w.params, row.day as string, row.day as string, row.taken_at as number, row.taken_at as number, id) as { n: number }
    return r.n
  }

  counts(): LibraryCounts {
    const r = this.stmts
      .get(`SELECT
        count(*) FILTER (WHERE ${VISIBLE}) AS all_,
        count(*) FILTER (WHERE ${VISIBLE} AND kind = 'photo') AS photos,
        count(*) FILTER (WHERE ${VISIBLE} AND kind = 'video') AS videos,
        count(*) FILTER (WHERE ${VISIBLE} AND is_live = 1) AS live,
        count(*) FILTER (WHERE ${VISIBLE} AND is_screenshot = 1) AS screenshots,
        count(*) FILTER (WHERE ${VISIBLE} AND favorite = 1) AS favorites,
        count(*) FILTER (WHERE ${VISIBLE} AND is_raw = 1) AS raw,
        count(*) FILTER (WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NOT NULL) AS trash
        FROM assets`)
      .get() as Record<string, number>
    return {
      all: r.all_ ?? 0, photos: r.photos ?? 0, videos: r.videos ?? 0, live: r.live ?? 0,
      screenshots: r.screenshots ?? 0, favorites: r.favorites ?? 0, raw: r.raw ?? 0, trash: r.trash ?? 0
    }
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
