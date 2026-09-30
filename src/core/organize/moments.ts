import type { Db, Row } from '../db'
import { transaction } from '../db'

/**
 * Moments: the library cut into events by time gaps and distance, titled by place and date.
 * Trips: runs of moments away from home spanning several days.
 */

export interface MomentInput {
  id: number
  takenAt: number
  day: string
  lat: number | null
  lon: number | null
  city: string | null
  country: string | null
  kind: string
  quality: number | null
  dateReliable: boolean
}

export interface MomentDraft {
  items: MomentInput[]
  start: number
  end: number
  city: string | null
  country: string | null
  lat: number | null
  lon: number | null
}

const DEG = Math.PI / 180
export function distanceKm(lat1: number, lon1: number, lat2: number, lon2: number): number {
  const dLat = (lat2 - lat1) * DEG
  const dLon = (lon2 - lon1) * DEG
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * DEG) * Math.cos(lat2 * DEG) * Math.sin(dLon / 2) ** 2
  return 6371 * 2 * Math.asin(Math.sqrt(a))
}

const H = 3600000

/** Cut a time-ordered list into moments. */
export function segment(items: MomentInput[]): MomentDraft[] {
  const out: MomentDraft[] = []
  let cur: MomentInput[] = []
  const flush = (): void => {
    if (cur.length) out.push(draftOf(cur))
    cur = []
  }
  let lastGeo: MomentInput | null = null
  for (const it of items) {
    const prev = cur[cur.length - 1]
    if (prev) {
      const gap = it.takenAt - prev.takenAt
      let far = false
      if (it.lat !== null && it.lon !== null && lastGeo && lastGeo.lat !== null && lastGeo.lon !== null) far = distanceKm(it.lat, it.lon, lastGeo.lat, lastGeo.lon) > 3
      const differentCity = it.city && lastGeo?.city && it.city !== lastGeo.city
      if (gap > 4 * H || (gap > 40 * 60000 && (far || differentCity)) || it.day !== prev.day && gap > 2 * H) flush()
    }
    cur.push(it)
    if (it.lat !== null) lastGeo = it
  }
  flush()
  // merge tiny moments into a neighbour of the same day and place
  const merged: MomentDraft[] = []
  for (const m of out) {
    const last = merged[merged.length - 1]
    if (last && m.items.length < 3 && last.items[0]!.day === m.items[0]!.day && (last.city === m.city || !m.city) && m.start - last.end < 6 * H) {
      last.items.push(...m.items)
      Object.assign(last, draftOf(last.items))
    } else merged.push(m)
  }
  return merged
}

function draftOf(items: MomentInput[]): MomentDraft {
  const cities = new Map<string, number>()
  const countries = new Map<string, number>()
  let lat = 0, lon = 0, n = 0
  for (const it of items) {
    if (it.city) cities.set(it.city, (cities.get(it.city) ?? 0) + 1)
    if (it.country) countries.set(it.country, (countries.get(it.country) ?? 0) + 1)
    if (it.lat !== null && it.lon !== null) {
      lat += it.lat
      lon += it.lon
      n++
    }
  }
  const top = (m: Map<string, number>): string | null => [...m.entries()].sort((a, b) => b[1] - a[1])[0]?.[0] ?? null
  return { items, start: items[0]!.takenAt, end: items[items.length - 1]!.takenAt, city: top(cities), country: top(countries), lat: n ? lat / n : null, lon: n ? lon / n : null }
}

const MONTHS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre']
const WEEKDAYS = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi']

function parts(day: string): { y: number; m: number; d: number; wd: number } {
  const [y, m, d] = day.split('-').map(Number) as [number, number, number]
  return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() }
}

/** "12 août 2019", "12–15 août 2019", "30 août – 2 septembre 2019" */
export function dateRangeLabel(dayStart: string, dayEnd: string): string {
  const a = parts(dayStart)
  const b = parts(dayEnd)
  const dd = (n: number): string => (n === 1 ? '1er' : String(n))
  if (dayStart === dayEnd) return `${dd(a.d)} ${MONTHS[a.m - 1]} ${a.y}`
  if (a.y === b.y && a.m === b.m) return `${dd(a.d)}–${dd(b.d)} ${MONTHS[a.m - 1]} ${a.y}`
  if (a.y === b.y) return `${dd(a.d)} ${MONTHS[a.m - 1]} – ${dd(b.d)} ${MONTHS[b.m - 1]} ${a.y}`
  return `${dd(a.d)} ${MONTHS[a.m - 1]} ${a.y} – ${dd(b.d)} ${MONTHS[b.m - 1]} ${b.y}`
}

const HOLIDAYS: Array<[number, number, string]> = [[12, 25, 'Noël'], [12, 24, 'Réveillon de Noël'], [12, 31, 'Réveillon du Nouvel An'], [1, 1, 'Nouvel An'], [7, 14, '14 Juillet'], [10, 31, 'Halloween'], [2, 14, 'Saint-Valentin']]

/** Title and subtitle for a moment. Place first, otherwise the weekday and a special day when any. */
export function momentTitle(d: { dayStart: string; dayEnd: string; city: string | null; country: string | null; homeCity: string | null; n: number }): { title: string; subtitle: string } {
  const a = parts(d.dayStart)
  const range = dateRangeLabel(d.dayStart, d.dayEnd)
  const holiday = HOLIDAYS.find(([m, dd]) => m === a.m && dd === a.d)?.[2]
  const multi = d.dayStart !== d.dayEnd
  const weekend = !multi && (a.wd === 0 || a.wd === 6)
  if (d.city) {
    const away = d.homeCity && d.city !== d.homeCity
    const where = d.country && d.country !== 'France' && away ? `${d.city}, ${d.country}` : d.city
    if (holiday) return { title: `${holiday} à ${d.city}`, subtitle: range }
    if (multi && away) return { title: `Séjour à ${d.city}`, subtitle: `${where} · ${range}` }
    return { title: where, subtitle: `${weekend ? WEEKDAYS[a.wd]![0]!.toUpperCase() + WEEKDAYS[a.wd]!.slice(1) + ' ' : ''}${range}` }
  }
  if (holiday) return { title: holiday, subtitle: range }
  if (multi) return { title: range, subtitle: `${d.n} éléments` }
  const wd = WEEKDAYS[a.wd]!
  return { title: `${wd[0]!.toUpperCase()}${wd.slice(1)} ${range}`, subtitle: `${d.n} éléments` }
}

/** The city where most photos were taken, over the whole library. */
export function homeCity(db: Db): string | null {
  const r = db.prepare("SELECT place_city AS c, count(*) AS n FROM assets WHERE place_city IS NOT NULL AND hidden = 0 AND missing_at IS NULL GROUP BY 1 ORDER BY n DESC LIMIT 1").get() as { c: string; n: number } | undefined
  return r?.c ?? null
}

/** Stable signature of a moment: first item's id and day (survives re-segmentation when the start is unchanged). */
const sigOf = (m: MomentDraft): string => `${m.items[0]!.day}:${m.items[0]!.id}`

export interface RebuildResult {
  moments: number
  trips: number
}

/** Recompute every moment and trip from scratch (fast: one ordered scan), keeping user titles by signature. */
export function rebuildMoments(db: Db): RebuildResult {
  const rows = db
    .prepare(`SELECT id, taken_at, day, lat, lon, place_city, place_country, kind, quality, date_source
      FROM assets WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL ORDER BY taken_at, id`)
    .all() as Row[]
  const items: MomentInput[] = rows.map((r) => ({
    id: r.id as number, takenAt: r.taken_at as number, day: r.day as string, lat: r.lat as number | null, lon: r.lon as number | null,
    city: r.place_city as string | null, country: r.place_country as string | null, kind: r.kind as string, quality: r.quality as number | null,
    dateReliable: r.date_source === 'exif' || r.date_source === 'video'
  }))
  const home = homeCity(db)
  const drafts = segment(items)
  const custom = new Map((db.prepare('SELECT sig, title FROM moment_titles').all() as Array<{ sig: string; title: string }>).map((r) => [r.sig, r.title]))
  const cover = (its: MomentInput[]): number => [...its].sort((a, b) => (a.kind === 'video' ? 1 : 0) - (b.kind === 'video' ? 1 : 0) || (b.quality ?? 0) - (a.quality ?? 0))[0]!.id

  return transaction(db, () => {
    db.exec('DELETE FROM moment_assets; DELETE FROM moments; DELETE FROM trips;')
    const insM = db.prepare('INSERT INTO moments (sig, title, subtitle, start_at, end_at, day_start, day_end, city, country, lat, lon, n, cover_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
    const insMA = db.prepare('INSERT OR REPLACE INTO moment_assets (moment_id, asset_id) VALUES (?, ?)')
    const ids: number[] = []
    for (const m of drafts) {
      const dayStart = m.items[0]!.day
      const dayEnd = m.items[m.items.length - 1]!.day
      const sig = sigOf(m)
      const t = momentTitle({ dayStart, dayEnd, city: m.city, country: m.country, homeCity: home, n: m.items.length })
      const id = Number(insM.run(sig, custom.get(sig) ?? t.title, t.subtitle, m.start, m.end, dayStart, dayEnd, m.city, m.country, m.lat, m.lon, m.items.length, cover(m.items)).lastInsertRowid)
      ids.push(id)
      for (const it of m.items) insMA.run(id, it.id)
    }
    // trips: consecutive moments away from home, spanning ≥ 2 calendar days, with ≤ 2 days of gap
    let trips = 0
    const insT = db.prepare('INSERT INTO trips (sig, title, start_at, end_at, cities, n, cover_id) VALUES (?, ?, ?, ?, ?, ?, ?)')
    const setTrip = db.prepare('UPDATE moments SET trip_id = ? WHERE id = ?')
    let run: Array<{ m: MomentDraft; id: number }> = []
    const flushTrip = (): void => {
      if (run.length) {
        const first = run[0]!.m
        const last = run[run.length - 1]!.m
        const dayStart = first.items[0]!.day
        const dayEnd = last.items[last.items.length - 1]!.day
        const days = (Date.parse(dayEnd) - Date.parse(dayStart)) / 86400000 + 1
        const n = run.reduce((a, r) => a + r.m.items.length, 0)
        if (days >= 2 && n >= 8) {
          const cities = [...new Set(run.map((r) => r.m.city).filter((c): c is string => Boolean(c)))]
          const country = run.find((r) => r.m.country)?.m.country ?? null
          const where = cities.length === 0 ? (country ?? 'ailleurs') : cities.length === 1 ? cities[0]! : cities.length === 2 ? `${cities[0]} et ${cities[1]}` : `${cities[0]}, ${cities[1]} et ${cities.length - 2} autres`
          const a = parts(dayStart)
          const title = `${days >= 7 ? 'Voyage' : 'Escapade'} à ${where}`
          const sub = `${MONTHS[a.m - 1]![0]!.toUpperCase()}${MONTHS[a.m - 1]!.slice(1)} ${a.y} · ${dateRangeLabel(dayStart, dayEnd)}`
          const tid = Number(insT.run(`${dayStart}:${first.items[0]!.id}`, `${title} · ${sub}`, first.start, last.end, JSON.stringify(cities), n, cover(run.flatMap((r) => r.m.items))).lastInsertRowid)
          for (const r of run) setTrip.run(tid, r.id)
          trips++
        }
      }
      run = []
    }
    drafts.forEach((m, i) => {
      const away = m.city !== null && home !== null && m.city !== home && (m.country !== null)
      const geoUnknown = m.city === null
      const prev = run[run.length - 1]?.m
      const close = prev ? m.start - prev.end <= 2 * 86400000 : true
      if ((away || (geoUnknown && run.length > 0 && close)) && close) run.push({ m, id: ids[i]! })
      else {
        flushTrip()
        if (away) run.push({ m, id: ids[i]! })
      }
    })
    flushTrip()
    return { moments: drafts.length, trips }
  })
}
