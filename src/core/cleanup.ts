import type { Db } from './db'
import { hamming } from './media/analyze'
import { MISHAP_MIN } from './ml/mishaps'
import { bytesLabel } from './util'
import { localeTag, t } from '@shared/i18n'
import type { AssetKind, CleanupGroup, CleanupItem, CleanupReport, SuggestionCategory } from '@shared/types'

interface Rec {
  id: number
  name: string
  rel_dir: string
  ext: string
  kind: AssetKind
  size: number
  taken_at: number
  date_source: string
  width: number | null
  height: number | null
  duration: number | null
  quality: number | null
  sharpness: number | null
  brightness: number | null
  clip_dark: number | null
  clip_bright: number | null
  contrast: number | null
  mishap: number | null
  phash: string | null
  ph0: number | null
  ph1: number | null
  ph2: number | null
  ph3: number | null
  qhash: string | null
  make: string | null
  model: string | null
  exposure: number | null
  fnumber: number | null
  iso: number | null
  source_id: number
  favorite: number
  is_screenshot: number
  is_live: number
  thumb_v: number
  added_at: number
  in_album: number
}

const VISIBLE = 'a.hidden = 0 AND a.missing_at IS NULL AND a.trashed_at IS NULL'
const COPY_MARKERS = /(copie|copy|copies|duplicate|doublon|whatsapp|download|t[ée]l[ée]chargement|export|backup|sauvegarde|received|re[çc]u)/i
const COPY_NAME = /(\(\d+\)|[-_ ]copy|[-_ ]copie|^copie de |~\d+|-\d{1,2}$)/i
const ORIGINAL_FORMATS = new Set(['heic', 'heif', 'cr2', 'cr3', 'nef', 'arw', 'dng', 'raf', 'orf', 'rw2', 'jpg', 'jpeg', 'mov', 'mp4'])

function toItem(r: Rec): CleanupItem {
  return {
    id: r.id, name: r.name, relDir: r.rel_dir, ext: r.ext, kind: r.kind, size: r.size, takenAt: r.taken_at,
    width: r.width, height: r.height, duration: r.duration, quality: r.quality, favorite: r.favorite === 1, v: `${String(r.qhash ?? 'x').slice(0, 10)}${r.thumb_v}`
  }
}

class UnionFind {
  private parent = new Map<number, number>()
  find(x: number): number {
    let p = this.parent.get(x) ?? x
    if (p !== x) {
      p = this.find(p)
      this.parent.set(x, p)
    }
    return p
  }
  union(a: number, b: number): void {
    const ra = this.find(a)
    const rb = this.find(b)
    if (ra !== rb) this.parent.set(ra, rb)
  }
  groups(ids: Iterable<number>): number[][] {
    const m = new Map<number, number[]>()
    for (const id of ids) {
      const r = this.find(id)
      const g = m.get(r)
      if (g) g.push(id)
      else m.set(r, [id])
    }
    return [...m.values()].filter((g) => g.length > 1)
  }
}

const sameFormat = (a: Rec, b: Rec): boolean => a.ext === b.ext && a.width === b.width && a.height === b.height
const signature = (ids: number[]): string => [...ids].sort((a, b) => a - b).join(',')
const mp = (r: Rec): number => ((r.width ?? 0) * (r.height ?? 0)) / 1e6
const lowEntropy = (hex: string): boolean => {
  let bits = 0
  for (const c of hex) bits += [0, 1, 1, 2, 1, 2, 2, 3, 1, 2, 2, 3, 2, 3, 3, 4][parseInt(c, 16)]!
  return bits < 8 || bits > 56
}

/** Keep-score for exact copies: the "original" location wins over copies, favorites and album members win. */
function exactKeep(rs: Rec[]): { keep: Rec; reasons: string[] } {
  const score = (r: Rec): number =>
    r.favorite * 100 + r.in_album * 50 + (r.date_source === 'exif' ? 5 : 0) -
    (COPY_MARKERS.test(r.rel_dir) ? 20 : 0) - (COPY_NAME.test(r.name.replace(/\.[^.]+$/, '')) ? 15 : 0) -
    r.rel_dir.length / 1000 - r.added_at / 1e15
  const sorted = [...rs].sort((a, b) => score(b) - score(a))
  const keep = sorted[0]!
  const reasons: string[] = []
  if (keep.favorite) reasons.push(t('Favori'))
  if (keep.in_album) reasons.push(t('Présente dans un album'))
  if (rs.some((r) => r !== keep && (COPY_MARKERS.test(r.rel_dir) || COPY_NAME.test(r.name))) && !COPY_MARKERS.test(keep.rel_dir)) reasons.push(t('Les autres sont dans des dossiers ou noms de copies'))
  if (!reasons.length) reasons.push(t('Premier fichier importé'))
  return { keep, reasons }
}

/** Keep-score for visually identical files: highest resolution, then original format, then quality. */
function visualKeep(rs: Rec[]): { keep: Rec; reasons: string[] } {
  const score = (r: Rec): number => r.favorite * 1000 + r.in_album * 500 + mp(r) * 10 + (ORIGINAL_FORMATS.has(r.ext) ? 5 : 0) + (r.quality ?? 0) + r.size / 1e10
  const sorted = [...rs].sort((a, b) => score(b) - score(a))
  const keep = sorted[0]!
  const other = sorted[1]!
  const reasons: string[] = []
  if (keep.favorite) reasons.push(t('Favori'))
  if (mp(keep) > mp(other) * 1.2) reasons.push(t('Meilleure définition ({a} Mpx contre {b})', { a: mp(keep).toFixed(1), b: mp(other).toFixed(1) }))
  if (keep.ext !== other.ext && ORIGINAL_FORMATS.has(keep.ext)) reasons.push(t('Format d’origine ({ext})', { ext: keep.ext.toUpperCase() }))
  if (keep.size > other.size * 1.3) reasons.push(t('Fichier le plus complet'))
  if (!reasons.length) reasons.push(t('Même image, qualité équivalente'))
  return { keep, reasons }
}

/** Keep-score inside a burst: sharpness first, then exposure, then resolution. */
function burstKeep(rs: Rec[]): { keep: Rec; reasons: string[] } {
  const score = (r: Rec): number => r.favorite * 1000 + r.in_album * 500 + (r.quality ?? 0) * 100 + mp(r) * 0.1
  const sorted = [...rs].sort((a, b) => score(b) - score(a))
  const keep = sorted[0]!
  const others = sorted.slice(1)
  const reasons: string[] = []
  if (keep.favorite) reasons.push(t('Favori'))
  const avgSharp = others.reduce((a, r) => a + (r.sharpness ?? 0), 0) / others.length
  if ((keep.sharpness ?? 0) > avgSharp * 1.25) reasons.push(t('La plus nette'))
  const expo = (r: Rec): number => Math.abs((r.brightness ?? 0.47) - 0.47) + (r.clip_bright ?? 0) + Math.max(0, (r.clip_dark ?? 0) - 0.05)
  if (others.every((r) => expo(keep) + 0.04 < expo(r))) reasons.push(t('La mieux exposée'))
  if (others.every((r) => mp(keep) > mp(r) * 1.2)) reasons.push(t('Meilleure définition'))
  if (!reasons.length) reasons.push(t('Meilleure qualité d’ensemble'))
  return { keep, reasons }
}

function makeGroup(rs: Rec[], pick: (rs: Rec[]) => { keep: Rec; reasons: string[] }): CleanupGroup {
  const { keep, reasons } = pick(rs)
  const ordered = [keep, ...rs.filter((r) => r !== keep).sort((a, b) => a.taken_at - b.taken_at)]
  return {
    key: signature(rs.map((r) => r.id)),
    items: ordered.map(toItem),
    keepId: keep.id,
    reasons,
    reclaimable: rs.reduce((a, r) => a + (r === keep ? 0 : r.size), 0)
  }
}

export interface CleanupThresholds {
  visualHamming: number
  burstHamming: number
  burstWindowSec: number
}

export const DEFAULT_THRESHOLDS: CleanupThresholds = { visualHamming: 3, burstHamming: 14, burstWindowSec: 20 }

export function buildCleanupReport(db: Db, version: number, th: CleanupThresholds = DEFAULT_THRESHOLDS, creationsSource: number | null = null): CleanupReport {
  const rows = db
    .prepare(`SELECT a.id, a.name, a.rel_dir, a.ext, a.kind, a.size, a.taken_at, a.date_source, a.width, a.height, a.duration, a.quality,
        a.sharpness, a.brightness, a.clip_dark, a.clip_bright, a.contrast, a.mishap, a.phash, a.ph0, a.ph1, a.ph2, a.ph3, a.qhash, a.make, a.model, a.exposure, a.fnumber, a.iso, a.source_id,
        a.favorite, a.is_screenshot, a.is_live, a.thumb_v, a.added_at,
        EXISTS (SELECT 1 FROM album_assets aa WHERE aa.asset_id = a.id) AS in_album
      FROM assets a WHERE ${VISIBLE}`)
    .all() as unknown as Rec[]
  if (creationsSource !== null) {
    // derived photos (HDR fusions) are not duplicates of their sources
    for (let i = rows.length - 1; i >= 0; i--) if (rows[i]!.source_id === creationsSource) rows.splice(i, 1)
  }
  const ignored = new Set((db.prepare('SELECT signature FROM cleanup_ignored').all() as Array<{ signature: string }>).map((r) => r.signature))
  const byId = new Map(rows.map((r) => [r.id, r]))

  // 1. exact duplicates: same quick hash (size + head + tail); confirmed by SHA-256 before removal
  const byQ = new Map<string, Rec[]>()
  for (const r of rows) {
    if (!r.qhash) continue
    const g = byQ.get(r.qhash)
    if (g) g.push(r)
    else byQ.set(r.qhash, [r])
  }
  const exact: CleanupGroup[] = []
  const inExact = new Set<number>()
  for (const g of byQ.values()) {
    if (g.length < 2) continue
    const grp = makeGroup(g, exactKeep)
    if (ignored.has(grp.key)) continue
    exact.push(grp)
    for (const r of g) inExact.add(r.id)
  }

  // 2. photos by time for bursts; unreliable dates (file times) are skipped
  const photos = rows.filter((r) => r.kind === 'photo' && r.phash && !lowEntropy(r.phash))
  const timed = photos.filter((r) => r.date_source !== 'mtime' && r.date_source !== 'folder').sort((a, b) => a.taken_at - b.taken_at)
  const bracketGroups = detectBrackets(timed)
  const inBracket = new Set(bracketGroups.flat().map((r) => r.id))
  const burstUF = new UnionFind()
  const winMs = th.burstWindowSec * 1000
  for (let i = 0; i < timed.length; i++) {
    const a = timed[i]!
    for (let j = i + 1; j < timed.length && j < i + 40; j++) {
      const b = timed[j]!
      if (b.taken_at - a.taken_at > winMs) break
      if (inBracket.has(a.id) || inBracket.has(b.id)) continue
      if (a.qhash && a.qhash === b.qhash) continue
      const d = hamming(a.phash!, b.phash!)
      // same picture saved in another format or size is a visual duplicate, not a burst
      if (d <= th.visualHamming && !sameFormat(a, b)) continue
      if (d <= th.burstHamming) burstUF.union(a.id, b.id)
    }
  }
  const burstGroups = burstUF.groups(timed.map((r) => r.id)).filter((g) => g.length <= 60)
  const inBurst = new Map<number, number>()
  burstGroups.forEach((g, i) => g.forEach((id) => inBurst.set(id, i)))

  // 3. visual duplicates: pHash within a few bits via 4×16-bit multi-index (pigeonhole), not already exact or same burst
  const visualUF = new UnionFind()
  const bandMaps = [new Map<number, Rec[]>(), new Map<number, Rec[]>(), new Map<number, Rec[]>(), new Map<number, Rec[]>()]
  for (const r of photos) {
    const bands = [r.ph0, r.ph1, r.ph2, r.ph3]
    bands.forEach((b, k) => {
      if (b === null) return
      const m = bandMaps[k]!
      const l = m.get(b)
      if (l) l.push(r)
      else m.set(b, [r])
    })
  }
  const seenPair = new Set<string>()
  for (const m of bandMaps) {
    for (const bucket of m.values()) {
      if (bucket.length < 2 || bucket.length > 400) continue
      for (let i = 0; i < bucket.length; i++) {
        for (let j = i + 1; j < bucket.length; j++) {
          const a = bucket[i]!
          const b = bucket[j]!
          const pk = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`
          if (seenPair.has(pk)) continue
          seenPair.add(pk)
          if (a.qhash && a.qhash === b.qhash) continue
          const sameBurst = inBurst.has(a.id) && inBurst.get(a.id) === inBurst.get(b.id)
          if (sameBurst && sameFormat(a, b)) continue
          if (hamming(a.phash!, b.phash!) <= th.visualHamming) visualUF.union(a.id, b.id)
        }
      }
    }
  }
  const visual: CleanupGroup[] = []
  for (const g of visualUF.groups(photos.map((r) => r.id))) {
    const grp = makeGroup(g.map((id) => byId.get(id)!), visualKeep)
    if (!ignored.has(grp.key)) visual.push(grp)
  }
  const similar: CleanupGroup[] = []
  for (const g of burstGroups) {
    const grp = makeGroup(g.map((id) => byId.get(id)!), burstKeep)
    if (!ignored.has(grp.key)) similar.push(grp)
  }

  const brackets: CleanupGroup[] = []
  for (const g of bracketGroups) {
    const byExp = [...g].sort((a, b) => a.exposure! - b.exposure!)
    const mid = byExp[Math.floor(byExp.length / 2)]!
    const ev = Math.log2(byExp[byExp.length - 1]!.exposure! / byExp[0]!.exposure!)
    const grp: CleanupGroup = {
      key: signature(g.map((r) => r.id)),
      items: byExp.map(toItem),
      keepId: mid.id,
      reasons: [t('{n} expositions · {ev} IL d’écart', { n: g.length, ev: ev.toLocaleString(localeTag(), { maximumFractionDigits: 1 }) }), [mid.make, mid.model?.replace(mid.make ?? '', '').trim()].filter(Boolean).join(' ')].filter(Boolean),
      reclaimable: 0
    }
    if (!ignored.has(grp.key)) brackets.push(grp)
  }

  // 4. suggestions: never favorites or album members
  const now = Date.now()
  const eligible = rows.filter((r) => !r.favorite && !r.in_album && !ignored.has(`item:${r.id}`))
  const cat = (id: SuggestionCategory['id'], title: string, description: string, list: Rec[]): SuggestionCategory => ({
    id, title, description, items: list.sort((a, b) => b.taken_at - a.taken_at).map(toItem), bytes: list.reduce((a, r) => a + r.size, 0)
  })
  const isPhoto = (r: Rec): boolean => r.kind === 'photo' && r.sharpness !== null
  const blurry = eligible.filter((r) => isPhoto(r) && !r.is_screenshot && (r.contrast ?? 0) > 0.08 && r.sharpness! / Math.pow((r.contrast ?? 0.1) * 255, 2) < 0.025 && r.sharpness! < 40)
  const dark = eligible.filter((r) => isPhoto(r) && (r.brightness ?? 1) < 0.08 && (r.clip_dark ?? 0) > 0.7)
  const measured = new Set([...blurry, ...dark])
  const suggestions: SuggestionCategory[] = [
    cat('screenshots', t('Anciennes captures d’écran'), t('Captures et enregistrements d’écran de plus de 3 mois, souvent inutiles une fois consultés.'), eligible.filter((r) => r.is_screenshot && r.taken_at < now - 90 * 86400000)),
    cat('mishaps', t('Photos prises par erreur'), t('Le sol, le plafond, un doigt sur l’objectif, l’intérieur d’une poche : reconnues par l’analyse sur cet ordinateur.'), eligible.filter((r) => r.kind === 'photo' && !r.is_screenshot && (r.mishap ?? 0) >= MISHAP_MIN && !measured.has(r))),
    cat('blurry', t('Photos floues'), t('Très peu de détails nets pour le contraste de l’image.'), blurry),
    cat('dark', t('Photos presque noires'), t('Prises par erreur, dans une poche ou objectif masqué.'), dark),
    cat('overexposed', t('Photos surexposées'), t('Image en grande partie blanche.'), eligible.filter((r) => isPhoto(r) && !r.is_screenshot && (r.clip_bright ?? 0) > 0.55)),
    cat('shortVideos', t('Vidéos très courtes'), t('Moins de 2 secondes, souvent déclenchées par erreur.'), eligible.filter((r) => r.kind === 'video' && r.duration !== null && r.duration < 2)),
    cat('largeVideos', t('Très grosses vidéos'), t('Plus de {size} chacune. Pensez à les convertir en HEVC plutôt qu’à les supprimer.', { size: bytesLabel(1024 ** 3) }), eligible.filter((r) => r.kind === 'video' && r.size > 1024 ** 3))
  ].filter((c) => c.items.length > 0)

  const byReclaim = (a: CleanupGroup, b: CleanupGroup): number => b.reclaimable - a.reclaimable
  return {
    exact: exact.sort(byReclaim),
    brackets: brackets.sort((a, b) => b.items[0]!.takenAt - a.items[0]!.takenAt),
    visual: visual.sort(byReclaim),
    similar: similar.sort((a, b) => b.items[0]!.takenAt - a.items[0]!.takenAt),
    suggestions,
    analyzed: rows.filter((r) => r.kind === 'video' || r.phash).length,
    total: rows.length,
    version
  }
}

/**
 * Exposure brackets: consecutive frames from the same camera and aperture/ISO, a few seconds apart,
 * each with a different shutter speed, same framing, and at least 1.5 EV between extremes.
 */
function detectBrackets(timed: Rec[]): Rec[][] {
  const out: Rec[][] = []
  let cur: Rec[] = []
  const close = (): void => {
    if (cur.length >= 2) {
      const exps = cur.map((r) => r.exposure!)
      const ev = Math.log2(Math.max(...exps) / Math.min(...exps))
      if ((cur.length >= 3 && ev >= 1.5) || (cur.length === 2 && ev >= 2)) out.push(cur)
    }
    cur = []
  }
  for (const r of timed) {
    if (!r.exposure || r.exposure <= 0 || !r.model) {
      close()
      continue
    }
    const prev = cur[cur.length - 1]
    const fits =
      prev &&
      r.taken_at - prev.taken_at <= 2500 &&
      r.model === prev.model &&
      r.fnumber === prev.fnumber &&
      r.iso === prev.iso &&
      r.width === prev.width &&
      !cur.some((c) => Math.abs(Math.log2(c.exposure! / r.exposure!)) < 0.2) &&
      // over- and under-exposed frames lose structure: rely on timing when frames are very close
      (r.taken_at - prev.taken_at <= 1500 || hamming(prev.phash!, r.phash!) <= 22)
    if (!fits) close()
    cur.push(r)
  }
  close()
  return out
}
