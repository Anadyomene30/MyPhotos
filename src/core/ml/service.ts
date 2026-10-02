import { existsSync, mkdirSync } from 'node:fs'
import { mkdir, rename, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import type { Db, Row } from '../db'
import { transaction } from '../db'
import { openImage, type DecodeInput } from '../media/decode'
import { MlClient } from './client'
import { downloadPack, MODEL_PACKS, packInstalled, type ModelPack } from './models'
import { PersonClusterer } from './persons'
import { CATEGORIES, classify } from './categories'
import { MISHAP_PROMPTS, MISHAP_VERSION, mishapScore, SCREEN_MISHAP_PROMPTS, SCREEN_MISHAP_VERSION, screenMishapScore } from './mishaps'
import { fromBlob, toBlob, VectorStore } from './vectors'
import type { MlStatus, PersonPair, PersonSummary, SearchHit } from '@shared/types'
import { t } from '@shared/i18n'

export interface MlEvents {
  jobs(): void
  changed(): void
  status(): void
}

const CLIP_DIM = 512
/** unnamed people on fewer photos than this are tucked away under "Autres visages" (same rule as the People page) */
const MAIN_MIN_PHOTOS = 3
/** centroid cosine from which two people are proposed as possibly the same (calibrated on a real library) */
const SAME_PERSON_HINT = 0.4
const ANALYSIS_SIZE = 1600

/**
 * Local intelligence: face recognition, CLIP embeddings, categories and text search.
 * Everything runs on this machine; models are downloaded once into the data folder.
 */
export class MlService {
  readonly modelsDir: string
  private client: MlClient
  private clusterer: PersonClusterer | null = null
  private vectors = new VectorStore(CLIP_DIM)
  private categoryVecs: Float32Array[] | null = null
  private categoryIndex: number[][] = []
  private mishapVecs: Float32Array[] | null = null
  private screenVecs: Float32Array[] | null = null
  private downloading: { pack: string; done: number; total: number; ctrl: AbortController } | null = null
  private starting: Promise<void> | null = null
  private lastError: string | null = null
  private faceCacheDir: string

  constructor(private db: Db, dataDir: string, workerDir: string, private events: MlEvents) {
    this.modelsDir = join(dataDir, 'models')
    this.faceCacheDir = join(dataDir, 'cache', 'faces')
    mkdirSync(this.modelsDir, { recursive: true })
    this.client = new MlClient(workerDir)
  }

  // ------------------------------------------------------------- settings & status

  get enabled(): boolean {
    return (this.db.prepare("SELECT value FROM settings WHERE key = 'ml_enabled'").get() as { value: string } | undefined)?.value === '1'
  }

  setEnabled(on: boolean): void {
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('ml_enabled', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(on ? '1' : '0')
    this.events.status()
    if (on) void this.ensureStarted()
    else void this.client.stop()
  }

  installed(): Record<string, boolean> {
    const out: Record<string, boolean> = {}
    for (const p of MODEL_PACKS) out[p.id] = packInstalled(this.modelsDir, p)
    return out
  }

  status(): MlStatus {
    const inst = this.installed()
    const pending = (this.db.prepare("SELECT count(*) AS n FROM assets WHERE ml_state = 0 AND thumb_state = 1 AND hidden = 0 AND missing_at IS NULL").get() as { n: number }).n
    const done = (this.db.prepare('SELECT count(*) AS n FROM assets WHERE ml_state = 1').get() as { n: number }).n
    return {
      enabled: this.enabled,
      workerAvailable: this.client.available,
      installed: inst,
      packs: MODEL_PACKS.map((p) => ({ id: p.id, title: p.title, bytes: p.files.reduce((a, f) => a + f.size, 0) })),
      download: this.downloading ? { pack: this.downloading.pack, done: this.downloading.done, total: this.downloading.total } : null,
      running: this.client.ready,
      pending,
      done,
      persons: this.persons(true).filter((p) => !p.hidden && (p.name || p.photos >= MAIN_MIN_PHOTOS)).length,
      error: this.lastError
    }
  }

  async download(packId: string): Promise<void> {
    const pack = MODEL_PACKS.find((p) => p.id === packId)
    if (!pack) throw new Error(t('Modèle inconnu'))
    if (this.downloading) throw new Error(t('Un téléchargement est déjà en cours'))
    const ctrl = new AbortController()
    this.downloading = { pack: packId, done: 0, total: pack.files.reduce((a, f) => a + f.size, 0), ctrl }
    this.lastError = null
    this.events.status()
    let lastEmit = 0
    try {
      await downloadPack(this.modelsDir, pack, (done, total) => {
        this.downloading!.done = done
        this.downloading!.total = total
        if (Date.now() - lastEmit > 400) {
          lastEmit = Date.now()
          this.events.status()
        }
      }, ctrl.signal)
    } catch (e) {
      this.lastError = ctrl.signal.aborted ? null : (e as Error).message
      throw e
    } finally {
      this.downloading = null
      this.events.status()
    }
    if (this.enabled) {
      await this.client.stop()
      await this.ensureStarted()
    }
  }

  cancelDownload(): void {
    this.downloading?.ctrl.abort()
  }

  /** Start the worker with whatever packs are installed. */
  ensureStarted(): Promise<void> {
    if (this.starting) return this.starting
    const inst = this.installed()
    if (!this.enabled || !this.client.available || (!inst.faces && !inst.clip)) return Promise.resolve()
    if (this.client.ready.faces === Boolean(inst.faces) && this.client.ready.clip === Boolean(inst.clip) && (inst.faces || inst.clip)) return Promise.resolve()
    this.starting = (async () => {
      try {
        await this.client.stop()
        await this.client.start(this.modelsDir, Boolean(inst.faces), Boolean(inst.clip))
        if (this.client.ready.clip) {
          await this.prepareCategories()
          this.scoreMishaps()
        }
        this.lastError = null
      } catch (e) {
        this.lastError = (e as Error).message
      } finally {
        this.starting = null
        this.events.status()
      }
    })()
    return this.starting
  }

  get canIndex(): boolean {
    return this.enabled && (this.client.ready.faces || this.client.ready.clip)
  }

  async stop(): Promise<void> {
    await this.client.stop()
  }

  private async prepareCategories(): Promise<void> {
    if (this.categoryVecs) return
    const prompts: string[] = []
    this.categoryIndex = CATEGORIES.map((c) => c.prompts.map((p) => prompts.push(p) - 1))
    this.categoryVecs = await this.client.clipTexts(prompts)
    this.mishapVecs = await this.client.clipTexts([...MISHAP_PROMPTS])
    this.screenVecs = await this.client.clipTexts([...SCREEN_MISHAP_PROMPTS])
  }

  private mishapOf(clip: Float32Array): number {
    return mishapScore(this.mishapVecs!.map((v) => dot(v, clip)))
  }

  private screenMishapOf(clip: Float32Array): number {
    return screenMishapScore(this.screenVecs!.map((v) => dot(v, clip)))
  }

  /** Score, from the stored embeddings, what was indexed before the prompts last changed (or before they existed). */
  private scoreMishaps(): void {
    if (!this.mishapVecs || !this.screenVecs) return
    this.backfill('mishap', 'mishap_v', MISHAP_VERSION, (e) => this.mishapOf(e))
    this.backfill('screen_mishap', 'screen_mishap_v', SCREEN_MISHAP_VERSION, (e) => this.screenMishapOf(e))
  }

  private backfill(column: 'mishap' | 'screen_mishap', key: string, version: number, score: (emb: Float32Array) => number): void {
    const stored = (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value
    const all = stored !== String(version)
    const rows = this.db.prepare(`SELECT c.asset_id, c.emb FROM clip_emb c JOIN assets a ON a.id = c.asset_id${all ? '' : ` WHERE a.${column} IS NULL`}`).all() as Array<{ asset_id: number; emb: Uint8Array }>
    transaction(this.db, () => {
      const upd = this.db.prepare(`UPDATE assets SET ${column} = ? WHERE id = ?`)
      for (const r of rows) upd.run(score(fromBlob(r.emb)), r.asset_id)
      this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, String(version))
    })
  }

  // ------------------------------------------------------------- indexing

  /** Load stored CLIP vectors into memory (once at startup). */
  loadVectors(): void {
    if (this.vectors.length) return
    const rows = this.db.prepare('SELECT asset_id, emb FROM clip_emb').all() as Array<{ asset_id: number; emb: Uint8Array }>
    for (const r of rows) this.vectors.set(r.asset_id, fromBlob(r.emb))
  }

  private clusterer_(): PersonClusterer {
    return (this.clusterer ??= new PersonClusterer(this.db))
  }

  /** Analyze one asset: faces + CLIP embedding + categories. Returns false on failure. */
  async indexAsset(row: Row, input: DecodeInput): Promise<boolean> {
    const id = row.id as number
    try {
      const img = await openImage(input)
      const { data, info } = await img.resize({ width: ANALYSIS_SIZE, height: ANALYSIS_SIZE, fit: 'inside', withoutEnlargement: true }).removeAlpha().raw().toBuffer({ resolveWithObject: true })
      const w = info.width
      const h = info.height
      const faces = this.client.ready.faces && row.kind === 'photo' ? await this.client.faces(new Uint8Array(data.buffer, data.byteOffset, data.length), w, h) : []
      let clip: Float32Array | null = null
      if (this.client.ready.clip) {
        const copy = new Uint8Array(data.length)
        copy.set(data)
        clip = await this.client.clipImage(copy, w, h)
      }
      transaction(this.db, () => {
        this.db.prepare('DELETE FROM faces WHERE asset_id = ?').run(id)
        const ins = this.db.prepare('INSERT INTO faces (asset_id, x, y, w, h, kps, score, quality, emb) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        const cl = this.clusterer_()
        for (const f of faces) {
          const emb = f.emb instanceof Float32Array ? f.emb : new Float32Array(f.emb)
          const faceId = Number(ins.run(id, f.x, f.y, f.w, f.h, JSON.stringify(f.kps.map((v) => Math.round(v * 10000) / 10000)), f.score, f.quality, toBlob(emb)).lastInsertRowid)
          cl.add(faceId, emb, f.quality)
        }
        if (clip) {
          this.db.prepare('INSERT OR REPLACE INTO clip_emb (asset_id, emb) VALUES (?, ?)').run(id, toBlob(clip))
          this.vectors.set(id, clip)
          this.db.prepare('DELETE FROM categories WHERE asset_id = ?').run(id)
          if (this.categoryVecs) {
            const sims = this.categoryVecs.map((v) => new Float32Array([dot(v, clip!)]))
            const insC = this.db.prepare('INSERT INTO categories (asset_id, label, score) VALUES (?, ?, ?)')
            for (const c of classify(sims, this.categoryIndex)) insC.run(id, c.id, c.score)
          }
          if (this.mishapVecs && this.screenVecs) this.db.prepare('UPDATE assets SET mishap = ?, screen_mishap = ? WHERE id = ?').run(this.mishapOf(clip), this.screenMishapOf(clip), id)
        }
        // faces define the focal point: area-weighted centre, kept a little above centre for headroom
        const good = faces.filter((f) => f.score >= 0.7)
        if (good.length) {
          let wsum = 0, fx = 0, fy = 0
          for (const f of good) {
            const wgt = f.w * f.h
            wsum += wgt
            fx += (f.x + f.w / 2) * wgt
            fy += (f.y + f.h / 2) * wgt
          }
          this.db.prepare('UPDATE assets SET focal_x = ?, focal_y = ?, ml_state = 1 WHERE id = ?').run(Math.min(0.95, Math.max(0.05, fx / wsum)), Math.min(0.95, Math.max(0.05, fy / wsum)), id)
        } else this.db.prepare('UPDATE assets SET ml_state = 1 WHERE id = ?').run(id)
      })
      this.refreshSearchText([id])
      return true
    } catch (e) {
      this.lastError = (e as Error).message
      this.db.prepare('UPDATE assets SET ml_state = 2 WHERE id = ?').run(id)
      return false
    }
  }

  /** After a batch: merge auto-created duplicates and pick covers for new people. */
  afterBatch(): void {
    const cl = this.clusterer_()
    cl.mergeSimilarUnnamed()
    this.db.exec(`UPDATE persons SET cover_face_id = (
        SELECT f.id FROM faces f JOIN assets a ON a.id = f.asset_id
        WHERE f.person_id = persons.id AND f.hidden = 0 AND a.trashed_at IS NULL AND a.missing_at IS NULL
        ORDER BY f.quality DESC, f.score DESC LIMIT 1)
      WHERE cover_face_id IS NULL OR cover_face_id NOT IN (SELECT id FROM faces WHERE person_id = persons.id)`)
  }

  // ------------------------------------------------------------- search text

  /** Rebuild the searchable text (file name, place, people, categories) of some assets. */
  refreshSearchText(ids: number[]): void {
    // both languages are indexed so a search works whatever language it was indexed in
    const labels = new Map(CATEGORIES.map((c) => [c.id, [...new Set([c.labelIn('fr'), c.labelIn('en')])].join(' ')]))
    const get = this.db.prepare(`SELECT a.name, a.rel_dir, a.place_city, a.place_admin, a.place_country, a.make, a.model, a.day,
        (SELECT group_concat(p.name, ' ') FROM faces f JOIN persons p ON p.id = f.person_id WHERE f.asset_id = a.id AND p.name IS NOT NULL) AS people,
        (SELECT group_concat(c.label, ' ') FROM categories c WHERE c.asset_id = a.id) AS cats
      FROM assets a WHERE a.id = ?`)
    const up = this.db.prepare('INSERT INTO search_text (asset_id, text) VALUES (?, ?) ON CONFLICT(asset_id) DO UPDATE SET text = excluded.text')
    transaction(this.db, () => {
      for (const id of ids) {
        const r = get.get(id) as Record<string, string | null> | undefined
        if (!r) continue
        const cats = (r.cats ?? '').split(' ').filter(Boolean).map((c) => labels.get(c) ?? c).join(' ')
        const text = [r.name?.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' '), r.rel_dir?.replace(/[/_-]+/g, ' '), r.place_city, r.place_admin, r.place_country, r.make, r.model, r.day, r.people, cats]
          .filter(Boolean)
          .join(' ')
        up.run(id, text)
      }
    })
  }

  refreshSearchTextForPerson(personId: number): void {
    const ids = (this.db.prepare('SELECT DISTINCT asset_id FROM faces WHERE person_id = ?').all(personId) as Array<{ asset_id: number }>).map((r) => r.asset_id)
    this.refreshSearchText(ids)
  }

  // ------------------------------------------------------------- search

  /** Combined search: text matches (names, places, people, categories) plus semantic similarity. */
  async search(query: string, limit = 400): Promise<SearchHit[]> {
    const q = query.trim()
    if (!q) return []
    const scores = new Map<number, number>()
    // full-text: every token as a prefix, ranked by bm25
    const tokens = q.split(/\s+/).filter((t) => t.length > 1).map((t) => `"${t.replace(/"/g, '')}"*`)
    if (tokens.length) {
      try {
        const rows = this.db.prepare('SELECT rowid AS id, bm25(search_fts) AS rank FROM search_fts WHERE search_fts MATCH ? ORDER BY rank LIMIT ?').all(tokens.join(' AND '), limit) as Array<{ id: number; rank: number }>
        rows.forEach((r, i) => scores.set(r.id, 1.2 - i / Math.max(1, rows.length) * 0.4))
      } catch {
        /* malformed query */
      }
    }
    if (this.client.ready.clip && this.vectors.length) {
      const [vec] = await this.client.clipTexts([q])
      const hits = this.vectors.search(vec!, limit, 0.2)
      const top = hits[0]?.score ?? 0
      for (const h of hits) {
        // relative to the best hit: CLIP similarities are compressed around 0.2-0.35
        const rel = top > 0 ? Math.max(0, (h.score - 0.2) / Math.max(0.05, top - 0.2)) : 0
        if (rel < 0.55) continue
        scores.set(h.id, Math.max(scores.get(h.id) ?? 0, rel))
      }
    }
    const visible = new Set(
      (this.db.prepare(`SELECT id FROM assets WHERE id IN (SELECT value FROM json_each(?)) AND hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL`).all(JSON.stringify([...scores.keys()])) as Array<{ id: number }>).map((r) => r.id)
    )
    return [...scores.entries()].filter(([id]) => visible.has(id)).sort((a, b) => b[1] - a[1]).slice(0, limit).map(([id, score]) => ({ id, score }))
  }

  /** Photos visually similar to one asset. */
  similar(assetId: number, limit = 60): SearchHit[] {
    const row = this.db.prepare('SELECT emb FROM clip_emb WHERE asset_id = ?').get(assetId) as { emb: Uint8Array } | undefined
    if (!row) return []
    return this.vectors.search(fromBlob(row.emb), limit + 1, 0.7).filter((h) => h.id !== assetId).slice(0, limit)
  }

  // ------------------------------------------------------------- people

  persons(includeSmall = false): PersonSummary[] {
    const rows = this.db
      .prepare(`SELECT p.id, p.name, p.hidden, p.cover_face_id,
          (SELECT count(DISTINCT f.asset_id) FROM faces f JOIN assets a ON a.id = f.asset_id WHERE f.person_id = p.id AND f.hidden = 0 AND a.trashed_at IS NULL AND a.missing_at IS NULL) AS photos
        FROM persons p WHERE p.n >= ${includeSmall ? 1 : 2} ORDER BY (p.name IS NULL), photos DESC`)
      .all() as Array<{ id: number; name: string | null; hidden: number; cover_face_id: number | null; photos: number }>
    return rows.filter((r) => r.photos > 0).map((r) => ({ id: r.id, name: r.name, hidden: r.hidden === 1, coverFaceId: r.cover_face_id, photos: r.photos }))
  }

  renamePerson(id: number, name: string | null): void {
    this.db.prepare('UPDATE persons SET name = ? WHERE id = ?').run(name?.trim() || null, id)
    this.refreshSearchTextForPerson(id)
    this.events.changed()
  }

  hidePerson(id: number, hidden: boolean): void {
    this.db.prepare('UPDATE persons SET hidden = ? WHERE id = ?').run(hidden ? 1 : 0, id)
    this.events.changed()
  }

  mergePersons(into: number, from: number[]): void {
    const cl = this.clusterer_()
    transaction(this.db, () => {
      for (const f of from) {
        if (f === into) continue
        cl.merge(into, f)
        this.db.prepare('DELETE FROM person_not_same WHERE a = ? OR b = ?').run(f, f)
      }
    })
    this.afterBatch()
    this.refreshSearchTextForPerson(into)
    this.events.changed()
  }

  /**
   * Pairs of people who may be the same person (split clusters: different ages, glasses, lighting).
   * Most likely first; pairs already answered "no" and pairs of two differently named people are skipped.
   */
  mergeSuggestions(limit = 40): PersonPair[] {
    const people = new Map(this.persons(true).filter((p) => !p.hidden).map((p) => [p.id, p]))
    const rows = this.db.prepare('SELECT id, centroid FROM persons WHERE centroid IS NOT NULL AND hidden = 0').all() as Array<{ id: number; centroid: Uint8Array }>
    const vecs = rows.filter((r) => people.has(r.id)).map((r) => ({ id: r.id, v: fromBlob(r.centroid) }))
    const rejected = new Set((this.db.prepare('SELECT a, b FROM person_not_same').all() as Array<{ a: number; b: number }>).map((r) => `${r.a}:${r.b}`))
    const out: PersonPair[] = []
    for (let i = 0; i < vecs.length; i++) {
      const a = vecs[i]!
      for (let j = i + 1; j < vecs.length; j++) {
        const b = vecs[j]!
        let s = 0
        for (let k = 0; k < a.v.length; k++) s += a.v[k]! * b.v[k]!
        if (s < SAME_PERSON_HINT) continue
        const [lo, hi] = a.id < b.id ? [a.id, b.id] : [b.id, a.id]
        if (rejected.has(`${lo}:${hi}`)) continue
        const pa = people.get(a.id)!
        const pb = people.get(b.id)!
        if (pa.name && pb.name) continue
        // keep the named or bigger one first: it is the one the other merges into
        const first = pa.name || (!pb.name && pa.photos >= pb.photos) ? pa : pb
        out.push({ a: first, b: first === pa ? pb : pa, score: Math.round(s * 1000) / 1000, aFaces: [], bFaces: [] })
      }
    }
    const top = out.sort((x, y) => y.score - x.score).slice(0, limit)
    const sample = this.db.prepare('SELECT id FROM faces WHERE person_id = ? AND hidden = 0 ORDER BY quality DESC LIMIT 4')
    const faces = (id: number): number[] => (sample.all(id) as Array<{ id: number }>).map((r) => r.id)
    for (const p of top) {
      p.aFaces = faces(p.a.id)
      p.bFaces = faces(p.b.id)
    }
    return top
  }

  notSamePerson(a: number, b: number): void {
    const [lo, hi] = a < b ? [a, b] : [b, a]
    this.db.prepare('INSERT OR IGNORE INTO person_not_same (a, b) VALUES (?, ?)').run(lo, hi)
    this.events.changed()
  }

  setCover(personId: number, faceId: number): void {
    this.db.prepare('UPDATE persons SET cover_face_id = ? WHERE id = ?').run(faceId, personId)
    this.events.changed()
  }

  /** "This is not X": detach the face; optionally attach to another person. */
  moveFace(faceId: number, toPerson: number | null): void {
    const cl = this.clusterer_()
    const before = this.db.prepare('SELECT person_id FROM faces WHERE id = ?').get(faceId) as { person_id: number | null } | undefined
    transaction(this.db, () => {
      cl.detach(faceId)
      if (toPerson !== null) {
        this.db.prepare('UPDATE faces SET person_id = ? WHERE id = ?').run(toPerson, faceId)
        cl.recompute(toPerson)
      }
    })
    const assetId = (this.db.prepare('SELECT asset_id FROM faces WHERE id = ?').get(faceId) as { asset_id: number }).asset_id
    this.refreshSearchText([assetId])
    if (before?.person_id) this.afterBatch()
    this.events.changed()
  }

  /** Create a person from a loose face (naming someone the first time). */
  createPersonFromFace(faceId: number, name: string): number {
    const f = this.db.prepare('SELECT emb, person_id FROM faces WHERE id = ?').get(faceId) as { emb: Uint8Array; person_id: number | null } | undefined
    if (!f) throw new Error(t('Visage introuvable'))
    const cl = this.clusterer_()
    const id = transaction(this.db, () => {
      if (f.person_id !== null) cl.detach(faceId)
      const r = this.db.prepare('INSERT INTO persons (name, cover_face_id, n, created_at) VALUES (?, ?, 1, ?)').run(name.trim(), faceId, Date.now())
      const pid = Number(r.lastInsertRowid)
      this.db.prepare('UPDATE faces SET person_id = ? WHERE id = ?').run(pid, faceId)
      cl.recompute(pid)
      return pid
    })
    this.refreshSearchTextForPerson(id)
    this.events.changed()
    return id
  }

  facesOf(assetId: number): Array<{ id: number; x: number; y: number; w: number; h: number; personId: number | null; personName: string | null; quality: number; suggestions: Array<{ personId: number; name: string | null; score: number }> }> {
    const rows = this.db
      .prepare('SELECT f.id, f.x, f.y, f.w, f.h, f.person_id, f.quality, f.emb, p.name FROM faces f LEFT JOIN persons p ON p.id = f.person_id WHERE f.asset_id = ? AND f.hidden = 0 ORDER BY f.w * f.h DESC')
      .all(assetId) as Array<{ id: number; x: number; y: number; w: number; h: number; person_id: number | null; quality: number; emb: Uint8Array; name: string | null }>
    const cl = this.clusterer_()
    const names = new Map((this.db.prepare('SELECT id, name FROM persons').all() as Array<{ id: number; name: string | null }>).map((p) => [p.id, p.name]))
    return rows.map((r) => ({
      id: r.id, x: r.x, y: r.y, w: r.w, h: r.h, personId: r.person_id, personName: r.name, quality: r.quality,
      suggestions: r.person_id === null ? cl.suggest(fromBlob(r.emb)).map((s) => ({ ...s, name: names.get(s.personId) ?? null })) : []
    }))
  }

  /** Square face crop (WebP) for avatars, cached on disk. */
  async faceThumb(faceId: number, decode: (assetId: number) => Promise<DecodeInput | null>): Promise<string | null> {
    const file = join(this.faceCacheDir, `${faceId % 256}`.padStart(2, '0'), `${faceId}.webp`)
    if (existsSync(file)) return file
    const f = this.db.prepare('SELECT asset_id, x, y, w, h FROM faces WHERE id = ?').get(faceId) as { asset_id: number; x: number; y: number; w: number; h: number } | undefined
    if (!f) return null
    const input = await decode(f.asset_id)
    if (!input) return null
    try {
      const img = await openImage(input)
      const meta = await img.clone().metadata()
      const rot = meta.orientation && meta.orientation >= 5
      const W = rot ? meta.height! : meta.width!
      const H = rot ? meta.width! : meta.height!
      // square around the box with margin
      const cx = (f.x + f.w / 2) * W
      const cy = (f.y + f.h / 2) * H
      const side = Math.max(f.w * W, f.h * H) * 1.7
      const left = Math.max(0, Math.round(cx - side / 2))
      const top = Math.max(0, Math.round(cy - side / 2))
      const width = Math.min(W - left, Math.round(side))
      const height = Math.min(H - top, Math.round(side))
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.tmp`
      await img.extract({ left, top, width, height }).resize(200, 200, { fit: 'cover' }).webp({ quality: 80 }).toFile(tmp)
      await rename(tmp, file)
      return file
    } catch {
      return null
    }
  }

  /** Remove derived data of an asset (when its file is gone). */
  forget(assetId: number): void {
    this.vectors.remove(assetId)
  }

  async writeDebugManifest(): Promise<void> {
    await writeFile(join(this.modelsDir, 'README.txt'), t('Modèles téléchargés par MyPhotos. Supprimez ce dossier pour libérer l’espace ; ils seront retéléchargés si l’intelligence locale est activée.') + '\n')
  }
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

export type { ModelPack }
