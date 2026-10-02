import { transaction, type Db } from '../db'
import type { Album, SmartRule, SmartRules } from '@shared/types'

const VISIBLE = 'hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL'
const esc = (s: string): string => s.replace(/[\\%_]/g, (c) => '\\' + c)

/** Translate smart album rules into a SQL condition on the assets table. */
export function rulesToSql(r: SmartRules, depth = 0): { sql: string; params: Array<string | number> } {
  const parts: string[] = []
  const params: Array<string | number> = []
  for (const rule of r.rules) {
    const one = ruleSql(rule, depth)
    if (!one) continue
    parts.push(`(${one.sql})`)
    params.push(...one.params)
  }
  if (!parts.length) return { sql: '1', params: [] }
  return { sql: parts.join(r.match === 'any' ? ' OR ' : ' AND '), params }
}

function ruleSql(rule: SmartRule, depth: number): { sql: string; params: Array<string | number> } | null {
  switch (rule.field) {
    case 'kind': return { sql: 'kind = ?', params: [rule.value] }
    case 'favorite': return { sql: 'favorite = 1', params: [] }
    case 'live': return { sql: 'is_live = 1', params: [] }
    case 'screenshot': return { sql: 'is_screenshot = 1', params: [] }
    case 'raw': return { sql: 'is_raw = 1', params: [] }
    case 'hasLocation': return { sql: 'lat IS NOT NULL', params: [] }
    case 'noLocation': return { sql: 'lat IS NULL', params: [] }
    case 'year':
      if (rule.op === 'is') return { sql: 'day >= ? AND day <= ?', params: [`${rule.value}-01-01`, `${rule.value}-12-31`] }
      if (rule.op === 'before') return { sql: 'day < ?', params: [`${rule.value}-01-01`] }
      return { sql: 'day > ?', params: [`${rule.value}-12-31`] }
    case 'month': return { sql: 'substr(day, 6, 2) = ?', params: [String(rule.value).padStart(2, '0')] }
    case 'dateRange': return { sql: 'day >= ? AND day <= ?', params: [rule.from, rule.to] }
    case 'ext': return { sql: 'ext = ?', params: [rule.value.toLowerCase().replace(/^\./, '')] }
    case 'camera':
    case 'folder':
    case 'name': {
      const col = rule.field === 'camera' ? "coalesce(make, '') || ' ' || coalesce(model, '')" : rule.field === 'folder' ? 'rel_dir' : 'name'
      const like = `%${esc(rule.value)}%`
      return { sql: `${col} ${rule.op === 'notContains' ? 'NOT ' : ''}LIKE ? ESCAPE '\\'`, params: [like] }
    }
    case 'album':
      if (depth > 0) return null // no nested album references beyond one level
      return { sql: `assets.id ${rule.op === 'notIn' ? 'NOT ' : ''}IN (SELECT asset_id FROM album_assets WHERE album_id = ?)`, params: [rule.value] }
  }
}

interface AlbumRow {
  id: number
  name: string
  kind: 'manual' | 'smart'
  rules: string | null
  cover_id: number | null
  created_at: number
  updated_at: number
  sort_order: number
  owner_id: string | null
  visibility: string
  shared_with: string
}

function parseIds(v: string | null | undefined): string[] {
  try {
    const a: unknown = JSON.parse(v ?? '[]')
    return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []
  } catch {
    return []
  }
}

export class AlbumRepo {
  constructor(private db: Db) {}

  private row(id: number): AlbumRow | undefined {
    return this.db.prepare('SELECT * FROM albums WHERE id = ?').get(id) as unknown as AlbumRow | undefined
  }

  /** SQL condition selecting the album's assets (manual membership or smart rules). */
  condition(id: number): { sql: string; params: Array<string | number> } {
    const a = this.row(id)
    if (!a) return { sql: '0', params: [] }
    if (a.kind === 'smart') return rulesToSql(a.rules ? (JSON.parse(a.rules) as SmartRules) : { match: 'all', rules: [] })
    return { sql: 'assets.id IN (SELECT asset_id FROM album_assets WHERE album_id = ?)', params: [id] }
  }

  list(): Album[] {
    const rows = this.db.prepare('SELECT * FROM albums ORDER BY sort_order, name COLLATE NOCASE').all() as unknown as AlbumRow[]
    return rows.map((r) => this.toAlbum(r))
  }

  get(id: number): Album | null {
    const r = this.row(id)
    return r ? this.toAlbum(r) : null
  }

  private toAlbum(r: AlbumRow): Album {
    const cond = this.condition(r.id)
    const stats = this.db
      .prepare(`SELECT count(*) AS n, (SELECT id FROM assets WHERE ${VISIBLE} AND (${cond.sql}) ORDER BY day DESC, taken_at DESC LIMIT 1) AS latest FROM assets WHERE ${VISIBLE} AND (${cond.sql})`)
      .get(...cond.params, ...cond.params) as { n: number; latest: number | null }
    const coverId = r.cover_id ?? stats.latest
    const cover = coverId ? (this.db.prepare('SELECT thumb_v, qhash FROM assets WHERE id = ?').get(coverId) as { thumb_v: number; qhash: string | null } | undefined) : undefined
    const coverV = cover ? `${String(cover.qhash ?? 'x').slice(0, 10)}${cover.thumb_v}` : ''
    return {
      id: r.id,
      name: r.name,
      kind: r.kind,
      rules: r.rules ? (JSON.parse(r.rules) as SmartRules) : null,
      count: stats.n,
      coverId,
      coverV,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
      ownerId: r.owner_id ?? null,
      visibility: r.visibility === 'foyer' || r.visibility === 'choisis' ? r.visibility : 'perso',
      sharedWith: parseIds(r.shared_with)
    }
  }

  create(name: string, kind: 'manual' | 'smart', rules: SmartRules | null, assetIds: number[] = []): Album {
    const now = Date.now()
    const id = transaction(this.db, () => {
      const max = (this.db.prepare('SELECT coalesce(max(sort_order), 0) AS m FROM albums').get() as { m: number }).m
      const r = this.db
        // owned by this installation's household member when there is one (spec/01 § 7); claimed on joining otherwise
        .prepare("INSERT INTO albums (name, kind, rules, sort_order, created_at, updated_at, owner_id) VALUES (?, ?, ?, ?, ?, ?, (SELECT value FROM settings WHERE key = 'member_id'))")
        .run(name.trim() || 'Sans titre', kind, rules ? JSON.stringify(rules) : null, max + 1, now, now)
      const id = Number(r.lastInsertRowid)
      if (kind === 'manual' && assetIds.length) this.addAssetsTx(id, assetIds)
      return id
    })
    return this.get(id)!
  }

  update(id: number, patch: { name?: string; rules?: SmartRules; coverId?: number | null }): Album | null {
    const a = this.row(id)
    if (!a) return null
    this.db
      .prepare('UPDATE albums SET name = ?, rules = ?, cover_id = ?, updated_at = ? WHERE id = ?')
      .run(
        patch.name?.trim() || a.name,
        patch.rules ? JSON.stringify(patch.rules) : a.rules,
        patch.coverId === undefined ? a.cover_id : patch.coverId,
        Date.now(),
        id
      )
    return this.get(id)
  }

  remove(id: number): void {
    this.db.prepare('DELETE FROM albums WHERE id = ?').run(id)
  }

  private addAssetsTx(id: number, assetIds: number[]): number {
    const ins = this.db.prepare('INSERT OR IGNORE INTO album_assets (album_id, asset_id, added_at) VALUES (?, ?, ?)')
    const now = Date.now()
    let n = 0
    for (const a of assetIds) n += Number(ins.run(id, a, now).changes)
    this.db.prepare('UPDATE albums SET updated_at = ? WHERE id = ?').run(now, id)
    return n
  }

  addAssets(id: number, assetIds: number[]): number {
    const a = this.row(id)
    if (!a || a.kind !== 'manual') return 0
    return transaction(this.db, () => this.addAssetsTx(id, assetIds))
  }

  removeAssets(id: number, assetIds: number[]): number {
    return transaction(this.db, () => {
      const del = this.db.prepare('DELETE FROM album_assets WHERE album_id = ? AND asset_id = ?')
      let n = 0
      for (const a of assetIds) n += Number(del.run(id, a).changes)
      return n
    })
  }

  /** Albums containing an asset (for the info panel). */
  forAsset(assetId: number): Array<{ id: number; name: string }> {
    return this.db
      .prepare('SELECT a.id, a.name FROM albums a JOIN album_assets aa ON aa.album_id = a.id WHERE aa.asset_id = ? ORDER BY a.name')
      .all(assetId) as unknown as Array<{ id: number; name: string }>
  }
}
