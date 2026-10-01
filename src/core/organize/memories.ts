import sharp from 'sharp'
import type { Db, Row } from '../db'
import { transaction } from '../db'
import { fromBlob } from '../ml/vectors'
import { dateRangeLabel, monthName } from './moments'
import { t } from '@shared/i18n'
import type { MemoryKind, MemoryPage, MemoryTheme } from '@shared/types'

/**
 * Memories: automatically composed selections (best of a year, a trip, a person over the years, ...)
 * with an editorial page layout. Selection favours technical quality, faces and favourites, and
 * spreads picks over time and visual content so the result does not repeat itself.
 */

interface Cand {
  id: number
  takenAt: number
  day: string
  kind: string
  quality: number
  favorite: boolean
  faces: number
  screenshot: boolean
  phash: string | null
  /** phash as two 32-bit halves, parsed once (selection compares it many times) */
  ph?: [number, number] | null
  clip: Float32Array | null
  ratio: number
}

function loadCandidates(db: Db, where: string, params: Array<string | number>): Cand[] {
  const rows = db
    .prepare(`SELECT a.id, a.taken_at, a.day, a.kind, a.quality, a.favorite, a.is_screenshot, a.phash, a.ratio, a.make, a.model,
        (SELECT count(*) FROM faces f WHERE f.asset_id = a.id AND f.person_id IS NOT NULL) AS faces,
        (SELECT emb FROM clip_emb c WHERE c.asset_id = a.id) AS clip,
        EXISTS (SELECT 1 FROM categories c WHERE c.asset_id = a.id AND c.label IN ('document', 'screenshot')) AS doc
      FROM assets a WHERE a.hidden = 0 AND a.missing_at IS NULL AND a.trashed_at IS NULL AND a.kind = 'photo' AND ${where}`)
    .all(...params) as Row[]
  return rows
    .filter((r) => !r.is_screenshot && !r.doc && !(!r.make && !r.model && !r.faces))
    .map((r) => ({
      id: r.id as number, takenAt: r.taken_at as number, day: r.day as string, kind: r.kind as string,
      quality: (r.quality as number | null) ?? 0.4, favorite: r.favorite === 1, faces: r.faces as number,
      screenshot: false, phash: r.phash as string | null, clip: r.clip ? fromBlob(r.clip as Uint8Array) : null, ratio: (r.ratio as number | null) ?? 1.5
    }))
}

function popcount(x: number): number {
  x -= (x >>> 1) & 0x55555555
  x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
  return (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
}

function phDistance(a: [number, number], b: [number, number]): number {
  return popcount((a[0] ^ b[0]) >>> 0) + popcount((a[1] ^ b[1]) >>> 0)
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

/** similarity 0..1 between two candidates (CLIP when available, else perceptual hash) */
function similarity(a: Cand, b: Cand): number {
  if (a.clip && b.clip) return Math.max(0, (dot(a.clip, b.clip) - 0.5) / 0.5)
  if (a.ph && b.ph) return Math.max(0, 1 - phDistance(a.ph, b.ph) / 24)
  return 0
}

/**
 * Bound the MMR pool (quadratic in picks × pool) on large sets: split the period into time slices and keep the best
 * few of each, so a year of 10 000 photos still yields picks spread over the whole year.
 */
function shortlist<T extends { c: Cand; s: number }>(scored: T[], n: number): T[] {
  const cap = Math.max(200, n * 12)
  if (scored.length <= cap) return scored
  const byTime = [...scored].sort((a, b) => a.c.takenAt - b.c.takenAt)
  const slices = n * 4
  const per = Math.ceil(cap / slices)
  const out: T[] = []
  for (let k = 0; k < slices; k++) {
    const slice = byTime.slice(Math.floor((k * byTime.length) / slices), Math.floor(((k + 1) * byTime.length) / slices))
    out.push(...slice.sort((a, b) => b.s - a.s).slice(0, per))
  }
  return out
}

/**
 * Greedy maximal-marginal-relevance selection: each pick balances its own score against
 * similarity to what is already chosen, and against being taken too close in time.
 */
export function select(cands: Cand[], n: number, opts: { lambda?: number; timeSpreadMs?: number } = {}): Cand[] {
  for (const c of cands) if (c.ph === undefined) c.ph = c.phash ? [parseInt(c.phash.slice(0, 8), 16), parseInt(c.phash.slice(8, 16), 16)] : null
  const lambda = opts.lambda ?? 0.7
  const spread = opts.timeSpreadMs ?? 20 * 60000
  const scored = shortlist(cands.map((c) => ({ c, s: c.quality * 0.7 + (c.favorite ? 0.35 : 0) + Math.min(0.25, c.faces * 0.1) + (c.clip ? 0 : -0.05) })), n)
  const chosen: Cand[] = []
  const pool = new Set(scored)
  while (chosen.length < n && pool.size) {
    let best: { c: Cand; v: number; e: (typeof scored)[number] } | null = null
    for (const e of pool) {
      // near-identical frames (bursts, re-saves) never appear twice
      if (chosen.some((k) => (e.c.clip && k.clip ? dot(e.c.clip, k.clip) > 0.93 : false) || (e.c.ph && k.ph ? phDistance(e.c.ph, k.ph) <= 8 : false))) continue
      let maxSim = 0
      let nearTime = 0
      for (const k of chosen) {
        maxSim = Math.max(maxSim, similarity(e.c, k))
        if (Math.abs(e.c.takenAt - k.takenAt) < spread) nearTime = Math.max(nearTime, 1 - Math.abs(e.c.takenAt - k.takenAt) / spread)
      }
      const v = lambda * e.s - (1 - lambda) * (maxSim + nearTime * 0.6)
      if (!best || v > best.v) best = { c: e.c, v, e }
    }
    if (!best) break
    chosen.push(best.c)
    pool.delete(best.e)
  }
  return chosen.sort((a, b) => a.takenAt - b.takenAt)
}

/**
 * Editorial pagination, orientation-aware: portraits pair up in columns, landscapes take hero
 * and wide slots, so frames rarely need to crop much. Photos keep their chronological order
 * except for small local swaps that make a page work.
 */
export function paginate(items: Array<{ id: number; ratio: number; score: number }>, title: string, sub: string | null): MemoryPage[] {
  const pages: MemoryPage[] = []
  if (!items.length) return pages
  const rest = [...items]
  const heroes = new Set([...items].sort((a, b) => b.score - a.score).slice(0, Math.max(1, Math.ceil(items.length / 8))).map((i) => i.id))
  const isPortrait = (x: { ratio: number }): boolean => x.ratio < 0.9
  const take = (pred: (x: { ratio: number; id: number }) => boolean, n: number, window = 4): Array<{ id: number; ratio: number; score: number }> => {
    const out: Array<{ id: number; ratio: number; score: number }> = []
    for (let k = 0; k < rest.length && out.length < n && k < window + n; k++) {
      if (pred(rest[k]!)) out.push(rest[k]!)
    }
    for (const o of out) rest.splice(rest.indexOf(o), 1)
    return out
  }
  pages.push({ type: 'cover', ids: [items[0]!.id] })
  pages.push({ type: 'title', text: title, ...(sub ? { sub } : {}) })
  let rhythm = 0
  while (rest.length) {
    const head = rest[0]!
    const portraitsAhead = rest.slice(0, 4).filter(isPortrait).length
    if (heroes.has(head.id) && rhythm !== 1) {
      pages.push({ type: 'hero', ids: [rest.shift()!.id] })
      rhythm = 1
    } else if (portraitsAhead >= 2 && rhythm !== 2) {
      pages.push({ type: 'duo', ids: take(isPortrait, 2).map((x) => x.id) })
      rhythm = 2
    } else if (rest.length >= 5 && rhythm !== 3) {
      const big = take((x) => !isPortrait(x), 1, 2)
      const small = rest.splice(0, big.length ? 4 : 5)
      pages.push({ type: 'grid', ids: [...big, ...small].map((x) => x.id) })
      rhythm = 3
    } else if (rest.length >= 3 && rhythm !== 4) {
      const big = take((x) => !isPortrait(x), 1, 2)
      const small = rest.splice(0, big.length ? 2 : 3)
      pages.push({ type: 'trio', ids: [...big, ...small].map((x) => x.id) })
      rhythm = 4
    } else if (rest.length >= 2) {
      pages.push({ type: 'duo', ids: rest.splice(0, 2).map((x) => x.id) })
      rhythm = 2
    } else {
      pages.push({ type: 'hero', ids: [rest.shift()!.id] })
      rhythm = 1
    }
  }
  pages.push({ type: 'end', ids: items.slice(-3).map((x) => x.id) })
  return pages
}

/** Theme from the cover's dominant colour. */
export async function themeFor(coverThumb: string | null): Promise<MemoryTheme> {
  const fallback: MemoryTheme = { accent: '#1f2937', onAccent: 'light', bg: '#111113' }
  if (!coverThumb) return fallback
  try {
    const { dominant } = await sharp(coverThumb).stats()
    const { r, g, b } = dominant
    const lum = 0.2126 * r + 0.7152 * g + 0.0722 * b
    const hex = (v: number): string => Math.round(Math.max(0, Math.min(255, v))).toString(16).padStart(2, '0')
    // darken slightly for a background tint
    const bg = `#${hex(r * 0.22 + 12)}${hex(g * 0.22 + 12)}${hex(b * 0.22 + 14)}`
    return { accent: `#${hex(r)}${hex(g)}${hex(b)}`, onAccent: lum > 150 ? 'dark' : 'light', bg }
  } catch {
    return fallback
  }
}

export interface MemoryDraft {
  kind: MemoryKind
  key: string
  title: string
  subtitle: string | null
  ids: number[]
  coverId: number
}

function pick(cands: Cand[], n: number, key: string, kind: MemoryKind, title: string, subtitle: string | null, min = 8): MemoryDraft | null {
  if (cands.length < min) return null
  const chosen = select(cands, n)
  if (chosen.length < min) return null
  const cover = [...chosen].sort((a, b) => b.quality + (b.faces ? 0.2 : 0) + (b.favorite ? 0.3 : 0) - (a.quality + (a.faces ? 0.2 : 0) + (a.favorite ? 0.3 : 0)))[0]!
  return { kind, key, title, subtitle, ids: chosen.map((c) => c.id), coverId: cover.id }
}

/** Every memory the library currently supports. Keys are stable so regeneration keeps ids. */
export function proposeMemories(db: Db, now = new Date()): MemoryDraft[] {
  const out: MemoryDraft[] = []
  const y = now.getFullYear()

  // best of each year (past years with enough photos)
  const years = db.prepare("SELECT substr(day, 1, 4) AS y, count(*) AS n FROM assets WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL AND kind = 'photo' GROUP BY 1 HAVING n >= 24 ORDER BY 1 DESC").all() as Array<{ y: string; n: number }>
  for (const yr of years) {
    if (Number(yr.y) >= y) continue
    const d = pick(loadCandidates(db, 'a.day >= ? AND a.day <= ?', [`${yr.y}-01-01`, `${yr.y}-12-31`]), 32, `year:${yr.y}`, 'year', t('{year} en images', { year: yr.y }), t('Les meilleures photos de {year}', { year: yr.y }), 10)
    if (d) out.push(d)
  }

  // trips
  const trips = db.prepare('SELECT id, title, start_at, end_at, cities FROM trips ORDER BY start_at DESC').all() as Array<{ id: number; title: string; start_at: number; end_at: number; cities: string }>
  for (const trip of trips) {
    const cands = loadCandidates(db, 'a.id IN (SELECT ma.asset_id FROM moment_assets ma JOIN moments m ON m.id = ma.moment_id WHERE m.trip_id = ?)', [trip.id])
    const [title, sub] = trip.title.split(' · ')
    const d = pick(cands, 28, `trip:${Math.floor(trip.start_at / 86400000)}`, 'trip', title!, sub ?? null, 8)
    if (d) out.push(d)
  }

  // big moments not inside a trip
  const moments = db.prepare('SELECT id, title, subtitle, day_start, day_end, n FROM moments WHERE trip_id IS NULL AND n >= 30 ORDER BY start_at DESC LIMIT 60').all() as Array<{ id: number; title: string; subtitle: string | null; day_start: string; day_end: string; n: number }>
  for (const m of moments) {
    const cands = loadCandidates(db, 'a.id IN (SELECT asset_id FROM moment_assets WHERE moment_id = ?)', [m.id])
    const [yy, mm] = m.day_start.split('-').map(Number) as [number, number]
    const title = /\d/.test(m.title) ? m.title : t('{title}, {month} {year}', { title: m.title, month: monthName(mm), year: yy })
    const d = pick(cands, 20, `moment:${m.day_start}:${m.id}`, 'moment', title, m.subtitle, 8)
    if (d) out.push(d)
  }

  // named people over the years
  const persons = db.prepare(`SELECT p.id, p.name, count(DISTINCT f.asset_id) AS n, min(a.day) AS d0, max(a.day) AS d1
      FROM persons p JOIN faces f ON f.person_id = p.id JOIN assets a ON a.id = f.asset_id
      WHERE p.name IS NOT NULL AND p.hidden = 0 AND a.trashed_at IS NULL AND a.missing_at IS NULL GROUP BY p.id HAVING n >= 20`).all() as Array<{ id: number; name: string; n: number; d0: string; d1: string }>
  for (const p of persons) {
    const y0 = p.d0.slice(0, 4)
    const y1 = p.d1.slice(0, 4)
    const cands = loadCandidates(db, 'a.id IN (SELECT asset_id FROM faces WHERE person_id = ?)', [p.id])
    const d = pick(cands, 30, `person:${p.id}`, 'person', y0 === y1 ? t('{name} en {year}', { name: p.name, year: y0 }) : t('{name} au fil des ans', { name: p.name }), y0 === y1 ? null : `${y0} – ${y1}`, 12)
    if (d) out.push(d)
  }

  // categories with a personality
  const CATS: Array<[string, string, string]> = [
    ['pets', t('Vos animaux'), t('Les compagnons de toutes ces années')],
    ['sunset', t('Ciels et couchers de soleil'), t('Quand la lumière fait tout')],
    ['food', t('À table'), t('Bons moments et bonnes assiettes')],
    ['beach', t('Au bord de l’eau'), t('Plages, mer et vacances')],
    ['mountain', t('En altitude'), t('Les montagnes')],
    ['party', t('Les fêtes'), t('Anniversaires, mariages et soirées')]
  ]
  for (const [id, title, sub] of CATS) {
    const cands = loadCandidates(db, 'a.id IN (SELECT asset_id FROM categories WHERE label = ? AND score >= 0.5)', [id])
    const d = pick(cands, 24, `category:${id}`, 'category', title, sub, 15)
    if (d) out.push(d)
  }

  // on this week, N years ago
  const m = now.getMonth() + 1
  const dd = now.getDate()
  for (let back = 1; back <= 15; back++) {
    const yy = y - back
    const from = new Date(yy, m - 1, dd - 3)
    const to = new Date(yy, m - 1, dd + 3)
    const f = (d: Date): string => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    const cands = loadCandidates(db, 'a.day >= ? AND a.day <= ?', [f(from), f(to)])
    if (cands.length < 6) continue
    const days = [...new Set(cands.map((c) => c.day))].sort()
    const d = pick(cands, 16, `ago:${yy}:${m}:${Math.floor(dd / 7)}`, 'onThisDay', back === 1 ? t('Il y a un an') : t('Il y a {n} ans', { n: back }), `${dateRangeLabel(days[0]!, days[days.length - 1]!)}`, 6)
    if (d) out.push(d)
  }
  return out
}

/** Persist proposals: new keys are inserted, existing ones keep their id, title edits and pin state. */
export async function syncMemories(db: Db, drafts: MemoryDraft[], thumbPath: (id: number) => string): Promise<number> {
  const existing = new Map((db.prepare('SELECT id, key, title, asset_ids FROM memories').all() as Array<{ id: number; key: string; title: string; asset_ids: string }>).map((r) => [r.key, r]))
  let created = 0
  const now = Date.now()
  for (const d of drafts) {
    const prev = existing.get(d.key)
    if (prev) {
      // refresh selection only when it grew notably (keeps user-curated lists stable)
      const prevIds = JSON.parse(prev.asset_ids) as number[]
      if (d.ids.length > prevIds.length * 1.3) db.prepare('UPDATE memories SET asset_ids = ?, cover_id = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d.ids), d.coverId, now, prev.id)
      continue
    }
    const theme = await themeFor(thumbPath(d.coverId))
    db.prepare('INSERT INTO memories (kind, key, title, subtitle, cover_id, asset_ids, theme, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
      .run(d.kind, d.key, d.title, d.subtitle, d.coverId, JSON.stringify(d.ids), JSON.stringify(theme), now, now)
    created++
  }
  // drop stale, untouched auto memories whose content disappeared
  transaction(db, () => {
    for (const r of db.prepare("SELECT id, asset_ids FROM memories WHERE kind <> 'custom' AND pinned = 0 AND album_id IS NULL").all() as Array<{ id: number; asset_ids: string }>) {
      const ids = JSON.parse(r.asset_ids) as number[]
      const alive = (db.prepare(`SELECT count(*) AS n FROM assets WHERE id IN (SELECT value FROM json_each(?)) AND missing_at IS NULL AND trashed_at IS NULL`).get(JSON.stringify(ids)) as { n: number }).n
      if (alive < Math.min(6, ids.length / 2)) db.prepare('DELETE FROM memories WHERE id = ?').run(r.id)
    }
  })
  return created
}
