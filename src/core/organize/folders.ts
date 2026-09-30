import { existsSync } from 'node:fs'
import { mkdir, rename } from 'node:fs/promises'
import { dirname, join, relative, sep } from 'node:path'
import type { Db, Row } from '../db'
import { sanitize } from '../export/naming'

export interface MovePlanItem {
  assetId: number
  from: string
  to: string
  /** companion files moved together (live video, RAW) */
  companions: Array<{ from: string; to: string }>
}

export interface MovePlan {
  items: MovePlanItem[]
  /** assets already in the right folder */
  alreadyTidy: number
  /** assets skipped (missing, in trash, no date) */
  skipped: number
  sample: string[]
}

/**
 * Proposed layout: <source>/<year>/<year-month> <moment title>/<file>.
 * Only the library's own folders are considered; nothing is moved until `applyMovePlan`.
 */
export function buildMovePlan(db: Db, sourceId: number): MovePlan {
  const src = db.prepare('SELECT path FROM sources WHERE id = ?').get(sourceId) as { path: string } | undefined
  if (!src) return { items: [], alreadyTidy: 0, skipped: 0, sample: [] }
  const rows = db
    .prepare(`SELECT a.id, a.path, a.name, a.day, a.live_video, a.raw_companion, a.date_source, m.title AS moment
      FROM assets a LEFT JOIN moment_assets ma ON ma.asset_id = a.id LEFT JOIN moments m ON m.id = ma.moment_id
      WHERE a.source_id = ? AND a.hidden = 0 AND a.missing_at IS NULL AND a.trashed_at IS NULL ORDER BY a.taken_at`)
    .all(sourceId) as Row[]
  const items: MovePlanItem[] = []
  let tidy = 0
  let skipped = 0
  const taken = new Set<string>()
  for (const r of rows) {
    const day = r.day as string
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || r.date_source === 'mtime') {
      skipped++
      continue
    }
    const y = day.slice(0, 4)
    const ym = day.slice(0, 7)
    const moment = sanitize(String(r.moment ?? '').replace(/\s*·.*$/, '')).slice(0, 60)
    const folder = join(src.path, y, moment ? `${ym} ${moment}` : ym)
    const from = r.path as string
    let to = join(folder, r.name as string)
    if (dirname(from) === folder) {
      tidy++
      continue
    }
    let i = 2
    while (taken.has(to.toLowerCase()) || (existsSync(to) && to !== from)) {
      const n = String(r.name)
      const dot = n.lastIndexOf('.')
      to = join(folder, `${dot > 0 ? n.slice(0, dot) : n} (${i})${dot > 0 ? n.slice(dot) : ''}`)
      i++
    }
    taken.add(to.toLowerCase())
    const companions: MovePlanItem['companions'] = []
    for (const c of [r.live_video, r.raw_companion] as Array<string | null>) {
      if (c && existsSync(c)) companions.push({ from: c, to: join(folder, c.slice(c.lastIndexOf(sep) + 1)) })
    }
    items.push({ assetId: r.id as number, from, to, companions })
  }
  return { items, alreadyTidy: tidy, skipped, sample: items.slice(0, 12).map((it) => relative(src.path, it.to)) }
}

export interface MoveResult {
  moved: number
  failed: Array<{ assetId: number; error: string }>
}

/** Move files according to a plan (same volume renames), updating the database as each file lands. */
export async function applyMovePlan(db: Db, items: MovePlanItem[], onProgress?: (done: number) => void): Promise<MoveResult> {
  let moved = 0
  const failed: MoveResult['failed'] = []
  const srcOf = db.prepare('SELECT s.path AS root FROM assets a JOIN sources s ON s.id = a.source_id WHERE a.id = ?')
  const upd = db.prepare('UPDATE assets SET path = ?, rel_dir = ? WHERE id = ?')
  const updLive = db.prepare('UPDATE assets SET live_video = ? WHERE id = ?')
  const updRaw = db.prepare('UPDATE assets SET raw_companion = ? WHERE id = ?')
  const updHidden = db.prepare('UPDATE assets SET path = ?, rel_dir = ? WHERE path = ? AND hidden = 1')
  for (const [i, it] of items.entries()) {
    try {
      const root = (srcOf.get(it.assetId) as { root: string } | undefined)?.root
      if (!root) throw new Error('source inconnue')
      await mkdir(dirname(it.to), { recursive: true })
      if (existsSync(it.to)) throw new Error('un fichier existe déjà à la destination')
      await rename(it.from, it.to)
      const rel = relative(root, dirname(it.to)).split(sep).join('/')
      upd.run(it.to, rel, it.assetId)
      for (const c of it.companions) {
        try {
          if (existsSync(c.to) || !existsSync(c.from)) continue
          await rename(c.from, c.to)
          if (/\.(cr2|cr3|crw|nef|nrw|arw|dng|raf|orf|rw2|pef|srw)$/i.test(c.to)) updRaw.run(c.to, it.assetId)
          else updLive.run(c.to, it.assetId)
          updHidden.run(c.to, rel, c.from)
        } catch {
          /* companion stays where it is; the next scan re-pairs it */
        }
      }
      moved++
    } catch (e) {
      failed.push({ assetId: it.assetId, error: (e as Error).message })
    }
    onProgress?.(i + 1)
  }
  return { moved, failed }
}
