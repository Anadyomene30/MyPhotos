import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { stat } from 'node:fs/promises'
import { cpus } from 'node:os'
import { join, resolve } from 'node:path'
import { openDb, transaction, type Db, type Row } from './db'
import { AssetRepo } from './repo/assets'
import { AlbumRepo } from './repo/albums'
import { applyChanges, pairLivePhotos, scanSource } from './scan/scanner'
import { FolderWatcher } from './scan/watcher'
import { readMetadata } from './media/metadata'
import { fullHash, quickHash } from './media/hash'
import { fuseInWorker, renderInWorker } from './edit/runInWorker'
import { parseEdit } from './edit/render'
import { normalizeEdit, isNeutral, type PhotoEdit } from '@shared/edit/types'
import { mkdir as mkdirAsync } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { SHARP_EXTS } from './media/kinds'
import { buildCleanupReport } from './cleanup'
import { MlService } from './ml/service'
import { Geocoder } from './geo'
import { analyzeImage } from './media/analyze'
import { ThumbStore, type ThumbSize } from './media/thumbs'
import { limiter, throttle } from './util'
import { runExport, runFfmpeg, type ExportRunner } from './export/exporter'
import { planVideoEdit } from './edit/videoRender'
import type { VideoEdit } from '@shared/edit/video'
import { tmpdir } from 'node:os'
import { rm as rmAsync } from 'node:fs/promises'
import { isAbsolute, relative as relPath } from 'node:path'
import type { DecodeInput } from './media/decode'
import type { AssetKind, CleanupReport, ExportOptions, SearchHit, JobGroupState, LibraryState, ServerEvent, Source } from '@shared/types'

export interface LibraryOptions {
  dataDir: string
  /** disable background indexing (tests) */
  autoIndex?: boolean
  watch?: boolean
  /** Move files to the OS trash; returns the paths that failed. Provided by the Electron host. */
  moveToSystemTrash?: (paths: string[]) => Promise<string[]>
  /** folder where MyPhotos writes the photos it creates (HDR fusions, edits saved as copies) */
  creationsDir?: string
  /** folder holding bundled resources (geo dataset, ffmpeg) */
  resourcesDir?: string
  /** folder holding the built worker scripts (ml-worker.js, fusion-worker.js) */
  workerDir?: string
}

type Stage = 'meta' | 'thumb' | 'analyze' | 'ml'

const STAGE_LABEL: Record<Stage, string> = {
  meta: 'Lecture des métadonnées',
  thumb: 'Création des miniatures',
  analyze: 'Analyse des images',
  ml: 'Reconnaissance des visages et du contenu'
}

export class Library extends EventEmitter {
  readonly db: Db
  readonly assets: AssetRepo
  readonly albums: AlbumRepo
  readonly thumbs: ThumbStore
  readonly ml: MlService
  private geocoder: Geocoder | null | undefined
  private watcher: FolderWatcher | null
  private version = 1
  private scanning = false
  private indexing: Promise<void> | null = null
  private indexAgain = false
  private progress = new Map<string, JobGroupState>()
  private exports = new Map<string, ExportRunner>()
  private exportSeq = 0
  private closed = false
  private emitChanged = throttle(() => this.send({ type: 'library-changed', version: ++this.version }), 1000)
  private emitJobs = throttle(() => this.send({ type: 'jobs', jobs: this.jobs() }), 400)

  constructor(private opts: LibraryOptions) {
    super()
    mkdirSync(opts.dataDir, { recursive: true })
    this.db = openDb(join(opts.dataDir, 'library.db'))
    this.assets = new AssetRepo(this.db)
    this.albums = new AlbumRepo(this.db)
    this.assets.albumCondition = (id) => this.albums.condition(id)
    this.thumbs = new ThumbStore(join(opts.dataDir, 'cache'))
    this.watcher = opts.watch === false ? null : new FolderWatcher((root, paths) => void this.onFsChanges(root, paths))
    this.ml = new MlService(this.db, opts.dataDir, opts.workerDir ?? join(process.cwd(), 'out', 'main'), {
      jobs: () => this.emitJobs(),
      changed: () => this.emitChanged(),
      status: () => this.send({ type: 'ml-status', status: this.ml.status() })
    })
  }

  private geo(): Geocoder | null {
    if (this.geocoder !== undefined) return this.geocoder
    const dir = this.opts.resourcesDir ?? join(process.cwd(), 'resources')
    try {
      this.geocoder = Geocoder.load(dir)
    } catch {
      this.geocoder = null
    }
    return this.geocoder
  }

  async start(): Promise<void> {
    this.retryFailuresAfterUpgrade()
    this.ml.loadVectors()
    void this.ml.ensureStarted().then(() => this.kickIndexer())
    for (const s of this.sources()) this.watcher?.add(s.path)
    await this.rescanAll()
  }

  /** Bump when decoders or metadata readers improve: failed items and weak dates get a second chance. */
  private retryFailuresAfterUpgrade(): void {
    const INDEX_VERSION = 2
    const row = this.db.prepare("SELECT value FROM settings WHERE key = 'index_version'").get() as { value: string } | undefined
    if (Number(row?.value ?? 0) >= INDEX_VERSION) return
    this.db.exec(`UPDATE assets SET meta_state = 0 WHERE meta_state = 2 OR date_source IN ('mtime', 'filename');
      UPDATE assets SET thumb_state = 0 WHERE thumb_state = 2;`)
    this.db.prepare("INSERT INTO settings (key, value) VALUES ('index_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(String(INDEX_VERSION))
  }

  close(): void {
    this.closed = true
    void this.ml.stop()
    this.watcher?.close()
    this.db.close()
  }

  /** Signal that library content changed (albums, edits) so clients refresh. */
  changed(): void {
    this.emitChanged()
  }

  private send(e: ServerEvent): void {
    this.emit('event', e)
  }

  state(): LibraryState {
    return { sources: this.sources(), counts: this.assets.counts(), jobs: this.jobs(), scanning: this.scanning, version: this.version }
  }

  jobs(): JobGroupState[] {
    return [...this.progress.values()]
  }

  sources(): Source[] {
    return this.db
      .prepare(`SELECT s.id, s.path, s.added_at AS addedAt,
        (SELECT count(*) FROM assets a WHERE a.source_id = s.id AND a.hidden = 0 AND a.missing_at IS NULL) AS assetCount
        FROM sources s ORDER BY s.path`)
      .all() as unknown as Source[]
  }

  async addSource(path: string): Promise<Source> {
    const abs = resolve(path)
    const st = await stat(abs)
    if (!st.isDirectory()) throw new Error('Ce chemin n’est pas un dossier')
    const overlapping = this.sources().find((s) => abs.startsWith(s.path + '/') || abs.startsWith(s.path + '\\') || s.path.startsWith(abs + '/') || s.path.startsWith(abs + '\\') || s.path === abs)
    if (overlapping) throw new Error(`Ce dossier recoupe une source existante : ${overlapping.path}`)
    this.db.prepare('INSERT INTO sources (path, added_at) VALUES (?, ?)').run(abs, Date.now())
    this.watcher?.add(abs)
    void this.rescanAll()
    return this.sources().find((s) => s.path === abs)!
  }

  removeSource(id: number): void {
    const s = this.sources().find((x) => x.id === id)
    if (!s) return
    this.watcher?.remove(s.path)
    this.db.prepare('DELETE FROM sources WHERE id = ?').run(id)
    this.emitChanged()
  }

  private scanPromise: Promise<void> | null = null
  private scanAgain = false

  /** Rescan every source. Concurrent calls join the running scan and trigger one more pass. */
  rescanAll(): Promise<void> {
    if (this.scanPromise) {
      this.scanAgain = true
      return this.scanPromise
    }
    this.scanning = true
    this.send({ type: 'scan', scanning: true })
    this.scanPromise = (async () => {
      do {
        this.scanAgain = false
        for (const s of this.sources()) {
          if (this.closed) return
          await scanSource(this.db, s.id, s.path)
          this.emitChanged()
        }
      } while (this.scanAgain && !this.closed)
    })().finally(() => {
      this.scanning = false
      this.scanPromise = null
      if (!this.closed) {
        this.send({ type: 'scan', scanning: false })
        if (this.opts.autoIndex !== false) void this.kickIndexer()
      }
    })
    return this.scanPromise
  }

  private async onFsChanges(root: string, paths: string[]): Promise<void> {
    const s = this.sources().find((x) => x.path === root)
    if (!s || this.closed) return
    const n = await applyChanges(this.db, s.id, s.path, paths)
    if (n > 0) {
      this.emitChanged()
      if (this.opts.autoIndex !== false) this.kickIndexer()
    }
  }

  // ---------------------------------------------------------------- indexing

  kickIndexer(): Promise<void> {
    if (this.indexing) {
      this.indexAgain = true
      return this.indexing
    }
    this.indexing = (async () => {
      do {
        this.indexAgain = false
        await this.runStage('meta')
        pairLivePhotos(this.db)
        this.emitChanged()
        await this.runStage('thumb')
        await this.runStage('analyze')
        this.geocodePending()
        if (this.ml.canIndex) {
          await this.runStage('ml')
          this.ml.afterBatch()
          this.send({ type: 'ml-status', status: this.ml.status() })
        }
      } while (this.indexAgain && !this.closed)
    })().finally(() => {
      this.indexing = null
    })
    return this.indexing
  }

  private static PENDING: Record<Stage, string> = {
    meta: 'meta_state = 0 AND missing_at IS NULL',
    thumb: 'thumb_state = 0 AND meta_state <> 0 AND hidden = 0 AND missing_at IS NULL',
    analyze: 'analyze_state = 0 AND thumb_state = 1 AND hidden = 0 AND missing_at IS NULL',
    ml: 'ml_state = 0 AND thumb_state = 1 AND hidden = 0 AND missing_at IS NULL'
  }

  private pendingCount(stage: Stage): number {
    return (this.db.prepare(`SELECT count(*) AS n FROM assets WHERE ${Library.PENDING[stage]}`).get() as { n: number }).n
  }

  private async runStage(stage: Stage): Promise<void> {
    const concurrency = stage === 'ml' ? 3 : stage === 'thumb' ? Math.max(2, Math.floor(cpus().length / 2)) : Math.max(4, cpus().length)
    const run = limiter(concurrency)
    const select = this.db.prepare(`SELECT * FROM assets WHERE ${Library.PENDING[stage]} ORDER BY day DESC, taken_at DESC LIMIT 256`)
    let done = 0
    let failed = 0
    const group: JobGroupState = { id: stage, label: STAGE_LABEL[stage], total: this.pendingCount(stage), done: 0, failed: 0 }
    if (group.total === 0) return
    this.progress.set(stage, group)
    this.emitJobs()
    try {
      while (!this.closed) {
        const batch = select.all() as Row[]
        if (batch.length === 0) break
        await Promise.all(
          batch.map((row) =>
            run(async () => {
              const ok = stage === 'meta' ? await this.indexMeta(row) : stage === 'thumb' ? await this.indexThumb(row) : stage === 'analyze' ? await this.indexAnalysis(row) : await this.indexMl(row)
              if (ok) done++
              else failed++
              group.done = done + failed
              group.failed = failed
              group.total = Math.max(group.total, group.done + (batch.length - 1))
              this.emitJobs()
            })
          )
        )
        group.total = group.done + this.pendingCount(stage)
        if (stage === 'meta') this.emitChanged()
      }
    } finally {
      this.progress.delete(stage)
      this.emitJobs()
      this.emitChanged()
    }
  }

  /** Read EXIF / ffprobe and quick hash. Returns false on failure (the asset keeps its filesystem date). */
  async indexMeta(row: Row): Promise<boolean> {
    const id = row.id as number
    try {
      const m = await readMetadata(row.path as string, row.name as string, row.ext as string, row.kind as AssetKind, row.mtime as number, row.rel_dir as string)
      const qhash = await quickHash(row.path as string, row.size as number)
      if ((!m.width || !m.height) && row.kind === 'photo' && SHARP_EXTS.has(row.ext as string)) {
        try {
          const info = await sharp(row.path as string, { failOn: 'none', unlimited: true }).metadata()
          m.width = info.width ?? null
          m.height = info.height ?? null
          m.orientation ??= info.orientation ?? null
        } catch {
          /* dimensions stay unknown */
        }
      }
      let ratio: number | null = null
      if (m.width && m.height) ratio = m.orientation && m.orientation >= 5 ? m.height / m.width : m.width / m.height
      this.db.prepare(`UPDATE assets SET taken_at = ?, tz_offset = ?, day = ?, date_source = ?, width = ?, height = ?, orientation = ?, ratio = ?,
          duration = ?, lat = ?, lon = ?, make = ?, model = ?, lens = ?, iso = ?, fnumber = ?, exposure = ?, focal = ?,
          is_screenshot = ?, content_id = ?, qhash = ?, meta_state = 1 WHERE id = ?`)
        .run(m.takenAt, m.tzOffset, m.day, m.dateSource, m.width, m.height, m.orientation, ratio,
          m.duration, m.lat, m.lon, m.make, m.model, m.lens, m.iso, m.fnumber, m.exposure, m.focal,
          m.screenshot ? 1 : 0, m.contentId, qhash, id)
      this.db.prepare('UPDATE assets SET geo_state = 0 WHERE id = ?').run(id)
      return true
    } catch {
      this.db.prepare('UPDATE assets SET meta_state = 2 WHERE id = ?').run(id)
      return false
    }
  }

  async indexThumb(row: Row): Promise<boolean> {
    const id = row.id as number
    try {
      const r = await this.thumbs.generate(id, decodeInput(row), 'grid', 'background', parseEdit(row.edit))
      this.markThumb(row, r.width / r.height)
      return true
    } catch {
      this.db.prepare('UPDATE assets SET thumb_state = 2 WHERE id = ?').run(id)
      return false
    }
  }

  /** Faces, CLIP embedding and categories; videos use their poster frame. */
  private async indexMl(row: Row): Promise<boolean> {
    if (this.closed || !this.ml.canIndex) return false
    const input = row.kind === 'video' ? { path: this.thumbs.pathFor(row.id as number, 'grid'), ext: 'webp', kind: 'photo' as const, orientation: null, duration: null } : decodeInput(row)
    return this.ml.indexAsset(row, input)
  }

  /** Offline reverse geocoding for assets with GPS coordinates (fast, synchronous). */
  geocodePending(): void {
    const rows = this.db.prepare('SELECT id, lat, lon FROM assets WHERE geo_state = 0 AND meta_state <> 0 LIMIT 5000').all() as Array<{ id: number; lat: number | null; lon: number | null }>
    if (!rows.length) return
    const geo = this.geo()
    transaction(this.db, () => {
      const up = this.db.prepare('UPDATE assets SET place_city = ?, place_admin = ?, place_country = ?, place_cc = ?, geo_state = 1 WHERE id = ?')
      for (const r of rows) {
        const p = geo && r.lat !== null && r.lon !== null ? geo.lookup(r.lat, r.lon) : null
        up.run(p?.city ?? null, p?.admin ?? null, p?.country ?? null, p?.cc ?? null, r.id)
      }
    })
    this.ml.refreshSearchText(rows.map((r) => r.id))
    if (rows.length === 5000) this.geocodePending()
  }

  private searchCache = new Map<string, { version: number; ids: number[]; scores: Map<number, number> }>()

  /** Ranked ids for a search string (cached per library version). */
  async searchIds(query: string): Promise<{ ids: number[]; scores: Map<number, number> }> {
    const key = query.trim().toLowerCase()
    const c = this.searchCache.get(key)
    if (c && c.version === this.version) return c
    const hits: SearchHit[] = await this.ml.search(query)
    const entry = { version: this.version, ids: hits.map((h) => h.id), scores: new Map(hits.map((h) => [h.id, h.score])) }
    this.searchCache.set(key, entry)
    if (this.searchCache.size > 20) this.searchCache.delete(this.searchCache.keys().next().value!)
    return entry
  }

  /** Perceptual hash, sharpness and exposure from the grid thumbnail (never re-reads the original). */
  async indexAnalysis(row: Row): Promise<boolean> {
    const id = row.id as number
    try {
      const a = await analyzeImage(this.thumbs.pathFor(id, 'grid'))
      const mp = ((row.width as number | null) ?? 0) * ((row.height as number | null) ?? 0) / 1e6
      this.db.prepare(`UPDATE assets SET phash = ?, ph0 = ?, ph1 = ?, ph2 = ?, ph3 = ?, sharpness = ?, brightness = ?, clip_dark = ?, clip_bright = ?,
          contrast = ?, quality = ?, analyze_state = 1 WHERE id = ?`)
        .run(a.phash, a.bands[0], a.bands[1], a.bands[2], a.bands[3], a.sharpness, a.brightness, a.clipDark, a.clipBright, a.contrast,
          qualityScore(a.sharpness, a.brightness, a.clipDark, a.clipBright, mp), id)
      return true
    } catch {
      this.db.prepare('UPDATE assets SET analyze_state = 2 WHERE id = ?').run(id)
      return false
    }
  }

  private markThumb(row: Row, ratio: number): void {
    const known = row.edit ? null : (row.ratio as number | null)
    this.db.prepare('UPDATE assets SET thumb_state = 1, analyze_state = CASE WHEN thumb_state = 1 THEN analyze_state ELSE 0 END, ratio = ? WHERE id = ?').run(known ?? ratio, row.id as number)
  }

  /** Path to a thumbnail, generating it on demand (interactive priority). */
  async thumbnail(id: number, size: ThumbSize): Promise<string | null> {
    let row = this.assets.raw(id)
    if (!row) return null
    if (await this.thumbs.exists(id, size)) return this.thumbs.pathFor(id, size)
    if (row.meta_state === 0) {
      await this.indexMeta(row)
      row = this.assets.raw(id)!
    }
    try {
      const r = await this.thumbs.generate(id, decodeInput(row), size, 'interactive', parseEdit(row.edit))
      if (size === 'grid') this.markThumb(row, r.width / r.height)
      return r.file
    } catch {
      return null
    }
  }

  // ---------------------------------------------------------------- cleanup

  private cleanupCache: CleanupReport | null = null

  cleanupReport(): CleanupReport {
    if (this.cleanupCache && this.cleanupCache.version === this.version) return this.cleanupCache
    this.cleanupCache = buildCleanupReport(this.db, this.version, undefined, this.creationsSourceId())
    return this.cleanupCache
  }

  private async sha(id: number): Promise<string | null> {
    const r = this.db.prepare('SELECT path, sha256, size, mtime FROM assets WHERE id = ?').get(id) as { path: string; sha256: string | null } | undefined
    if (!r) return null
    if (r.sha256) return r.sha256
    try {
      const h = await fullHash(r.path)
      this.db.prepare('UPDATE assets SET sha256 = ? WHERE id = ?').run(h, id)
      return h
    } catch {
      return null
    }
  }

  /**
   * Resolve exact-duplicate groups: each copy is verified byte-for-byte (SHA-256) against the kept file,
   * then moved to the internal trash. Unverified copies are left untouched.
   */
  async resolveExactDuplicates(groups: Array<{ keep: number; remove: number[] }>): Promise<{ trashed: number; skipped: number }> {
    const verified: number[] = []
    let skipped = 0
    const run = limiter(4)
    await Promise.all(
      groups.map((g) =>
        run(async () => {
          const ref = await this.sha(g.keep)
          for (const id of g.remove) {
            if (id === g.keep) continue
            const h = ref ? await this.sha(id) : null
            if (ref && h === ref) verified.push(id)
            else skipped++
          }
        })
      )
    )
    if (verified.length) this.setTrashed(verified, true)
    return { trashed: verified.length, skipped }
  }

  ignoreCleanup(signature: string, kind: string): void {
    this.db.prepare('INSERT OR IGNORE INTO cleanup_ignored (signature, kind, created_at) VALUES (?, ?, ?)').run(signature, kind, Date.now())
    this.cleanupCache = null
    this.emitChanged()
  }

  tilePath(z: number, x: number, y: number): string {
    return join(this.opts.dataDir, 'cache', 'tiles', String(z), String(x), `${y}.png`)
  }

  // ---------------------------------------------------------------- creations

  get creationsDir(): string {
    return resolve(this.opts.creationsDir ?? join(this.opts.dataDir, 'Créations'))
  }

  creationsSourceId(): number | null {
    return (this.db.prepare('SELECT id FROM sources WHERE path = ?').get(this.creationsDir) as { id: number } | undefined)?.id ?? null
  }

  private async ensureCreationsSource(): Promise<number> {
    await mkdirAsync(this.creationsDir, { recursive: true })
    const existing = this.creationsSourceId()
    if (existing !== null) return existing
    this.db.prepare('INSERT INTO sources (path, added_at) VALUES (?, ?)').run(this.creationsDir, Date.now())
    this.watcher?.add(this.creationsDir)
    return this.creationsSourceId()!
  }

  /**
   * Fuse an exposure bracket into one well-exposed photo, written to the creations folder.
   * Sources are only read. Returns immediately; a 'creation-done' event reports the result.
   */
  startFusion(ids: number[]): string {
    const rows = ids.map((id) => this.assets.raw(id)).filter((r): r is Row => Boolean(r) && r!.kind === 'photo')
    if (rows.length < 2) throw new Error('Choisissez au moins deux photos de la même scène')
    const jobId = `fusion-${++this.exportSeq}`
    const group: JobGroupState = { id: jobId, label: 'Fusion des expositions', total: 1, done: 0, failed: 0 }
    this.progress.set(jobId, group)
    this.emitJobs()
    void (async () => {
      let assetId: number | null = null
      try {
        const sourceId = await this.ensureCreationsSource()
        const ref = [...rows].sort((a, b) => (a.exposure as number) - (b.exposure as number))[Math.floor(rows.length / 2)]!
        const stem = String(ref.name).replace(/\.[^.]+$/, '')
        let out = join(this.creationsDir, `${stem} HDR.jpg`)
        for (let i = 2; existsSync(out); i++) out = join(this.creationsDir, `${stem} HDR ${i}.jpg`)
        const exif = exifFromRow(ref, 'MyPhotos HDR')
        await fuseInWorker({ inputs: rows.map(decodeInput), output: out, maxSize: 4096, align: true, exif })
        this.db.prepare('INSERT OR REPLACE INTO creations (path, kind, sources, created_at) VALUES (?, ?, ?, ?)').run(out, 'hdr', JSON.stringify(ids), Date.now())
        await applyChanges(this.db, sourceId, this.creationsDir, [out])
        const row = this.db.prepare('SELECT * FROM assets WHERE path = ?').get(out) as Row | undefined
        if (row) {
          await this.indexMeta(row)
          const fresh = this.assets.raw(row.id as number)!
          await this.indexThumb(fresh)
          await this.indexAnalysis(this.assets.raw(row.id as number)!)
          // keep the fusion in the same albums as its sources
          this.db.prepare(`INSERT OR IGNORE INTO album_assets (album_id, asset_id, added_at)
            SELECT DISTINCT album_id, ?, ? FROM album_assets WHERE asset_id IN (SELECT value FROM json_each(?))`).run(row.id as number, Date.now(), JSON.stringify(ids))
          assetId = row.id as number
        }
        this.cleanupCache = null
        this.emitChanged()
        this.send({ type: 'creation-done', ok: true, assetId, sources: ids })
      } catch (e) {
        this.send({ type: 'creation-done', ok: false, assetId: null, error: (e as Error).message, sources: ids })
      } finally {
        this.progress.delete(jobId)
        this.emitJobs()
      }
    })()
    return jobId
  }

  /**
   * Save the edits as a new full-resolution JPEG, stacked under the original as a version
   * (one item in the grid). The original file and its own settings are left untouched.
   */
  startEditedCopy(id: number, edit: PhotoEdit): string {
    const row = this.assets.raw(id)
    if (!row || row.kind !== 'photo') throw new Error('Photo introuvable')
    const main = (row.version_of as number | null) ?? id
    const jobId = `copy-${++this.exportSeq}`
    this.progress.set(jobId, { id: jobId, label: 'Enregistrement de la copie', total: 1, done: 0, failed: 0 })
    this.emitJobs()
    void (async () => {
      try {
        const sourceId = await this.ensureCreationsSource()
        const stem = String(row.name).replace(/\.[^.]+$/, '')
        let out = join(this.creationsDir, `${stem} (copie modifiée).jpg`)
        for (let i = 2; existsSync(out); i++) out = join(this.creationsDir, `${stem} (copie modifiée ${i}).jpg`)
        await renderInWorker({ input: decodeInput(row), edit: normalizeEdit(edit), output: out, quality: 95, exif: exifFromRow(row, 'MyPhotos copie modifiée') })
        this.db.prepare('INSERT OR REPLACE INTO creations (path, kind, sources, created_at) VALUES (?, ?, ?, ?)').run(out, 'edit-copy', JSON.stringify([main]), Date.now())
        await applyChanges(this.db, sourceId, this.creationsDir, [out])
        const r = this.db.prepare('SELECT * FROM assets WHERE path = ?').get(out) as Row | undefined
        if (r) {
          await this.indexMeta(r)
          await this.indexThumb(this.assets.raw(r.id as number)!)
        }
        this.emitChanged()
        this.send({ type: 'creation-done', ok: true, assetId: main, sources: [id] })
      } catch (e) {
        this.send({ type: 'creation-done', ok: false, assetId: null, error: (e as Error).message, sources: [id] })
      } finally {
        this.progress.delete(jobId)
        this.emitJobs()
      }
    })()
    return jobId
  }

  /** Turn a version back into a separate item of the grid. */
  detachVersion(id: number): void {
    this.db.prepare('UPDATE assets SET version_of = NULL, hidden = 0 WHERE id = ?').run(id)
    this.db.prepare("DELETE FROM creations WHERE path = (SELECT path FROM assets WHERE id = ?) AND kind = 'edit-copy'").run(id)
    this.emitChanged()
  }

  /** Render an edited copy of a video into the creations folder; the original is only read. */
  startVideoEdit(id: number, edit: VideoEdit): string {
    const row = this.assets.raw(id)
    if (!row || row.kind !== 'video') throw new Error('Vidéo introuvable')
    const jobId = `video-${++this.exportSeq}`
    const group: JobGroupState = { id: jobId, label: `Montage de ${row.name as string}`, total: 1, done: 0, failed: 0, progress: 0, cancellable: true }
    this.progress.set(jobId, group)
    this.emitJobs()
    const ctrl = new AbortController()
    this.exports.set(jobId, { result: Promise.resolve(null as never), cancel: () => ctrl.abort() })
    void (async () => {
      const trf = join(tmpdir(), `myphotos-${jobId}-${process.pid}.trf`)
      let out = ''
      try {
        const sourceId = await this.ensureCreationsSource()
        const stem = String(row.name).replace(/\.[^.]+$/, '')
        out = join(this.creationsDir, `${stem} (modifiée).mp4`)
        for (let i = 2; existsSync(out); i++) out = join(this.creationsDir, `${stem} (modifiée ${i}).mp4`)
        const plan = await planVideoEdit(row.path as string, out, edit, trf, new Date((row.taken_at as number) + edit.trim.start * 1000).toISOString())
        const dur = (((edit.trim.end ?? (row.duration as number | null) ?? 0) - edit.trim.start) / edit.speed) || null
        for (let p = 0; p < plan.passes.length; p++) {
          const base = p / plan.passes.length
          await runFfmpeg(plan.passes[p]!, dur, (f) => {
            group.progress = base + f / plan.passes.length
            this.emitJobs()
          }, ctrl.signal)
        }
        await applyChanges(this.db, sourceId, this.creationsDir, [out])
        const r = this.db.prepare('SELECT * FROM assets WHERE path = ?').get(out) as Row | undefined
        let assetId: number | null = null
        if (r) {
          await this.indexMeta(r)
          await this.indexThumb(this.assets.raw(r.id as number)!)
          assetId = r.id as number
          this.db.prepare('INSERT OR REPLACE INTO creations (path, kind, sources, created_at) VALUES (?, ?, ?, ?)').run(out, 'video-edit', JSON.stringify([id]), Date.now())
        }
        this.emitChanged()
        this.send({ type: 'creation-done', ok: true, assetId, sources: [id] })
      } catch (e) {
        if (out) await rmAsync(out, { force: true }).catch(() => undefined)
        this.send({ type: 'creation-done', ok: false, assetId: null, error: ctrl.signal.aborted ? 'annulé' : (e as Error).message, sources: [id] })
      } finally {
        await rmAsync(trf, { force: true }).catch(() => undefined)
        this.exports.delete(jobId)
        this.progress.delete(jobId)
        this.emitJobs()
      }
    })()
    return jobId
  }

  // ---------------------------------------------------------------- export

  /** Start an export job. Refuses destinations inside a library folder (exports would be re-imported). */
  startExport(opts: ExportOptions): string {
    if (!isAbsolute(opts.destination)) throw new Error('Choisissez un dossier de destination')
    const dest = resolve(opts.destination)
    for (const s of this.sources()) {
      const rel = relPath(s.path, dest)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error('Choisissez un dossier en dehors de la photothèque, sinon les fichiers exportés y seraient réimportés.')
    }
    const ids = [...new Set(opts.ids)]
    const rows: Row[] = []
    const get = this.db.prepare('SELECT * FROM assets WHERE id = ?')
    for (const id of ids) {
      const r = get.get(id) as Row | undefined
      if (r && r.missing_at === null) rows.push(r)
    }
    rows.sort((a, b) => (a.taken_at as number) - (b.taken_at as number))
    const jobId = `export-${++this.exportSeq}`
    const n = rows.length
    const group: JobGroupState = { id: jobId, label: `Export de ${n.toLocaleString('fr-FR')} élément${n > 1 ? 's' : ''}`, total: n, done: 0, failed: 0, progress: 0, cancellable: true }
    this.progress.set(jobId, group)
    this.emitJobs()
    const runner = runExport(jobId, rows, { ...opts, destination: dest }, (doneUnits, totalUnits) => {
      group.progress = totalUnits ? doneUnits / totalUnits : 1
      group.done = Math.min(n, Math.round(group.progress * n))
      this.emitJobs()
    })
    this.exports.set(jobId, runner)
    void runner.result
      .then((result) => this.send({ type: 'export-done', result }))
      .catch((e: Error) => this.send({ type: 'export-done', result: { jobId, exported: 0, failed: n, skipped: 0, destination: dest, cancelled: false, errors: [e.message] } }))
      .finally(() => {
        this.exports.delete(jobId)
        this.progress.delete(jobId)
        this.emitJobs()
      })
    return jobId
  }

  cancelJob(jobId: string): void {
    this.exports.get(jobId)?.cancel()
  }

  // ---------------------------------------------------------------- edits

  /** Unedited 2048 px working image for the editor. */
  async sourcePreview(id: number): Promise<string | null> {
    if (await this.thumbs.exists(id, 'source')) return this.thumbs.pathFor(id, 'source')
    const row = this.assets.raw(id)
    if (!row) return null
    try {
      return (await this.thumbs.generate(id, decodeInput(row), 'source', 'interactive', null)).file
    } catch {
      return null
    }
  }

  /** Save (or clear with null) non-destructive edits; the original file is never touched. */
  async setEdit(id: number, edit: PhotoEdit | null): Promise<void> {
    const row = this.assets.raw(id)
    if (!row || row.kind !== 'photo') throw new Error('Seules les photos peuvent être retouchées ici')
    const e = edit ? normalizeEdit(edit) : null
    const json = e && !isNeutral(e) ? JSON.stringify(e) : null
    this.db.prepare('UPDATE assets SET edit = ?, edited_at = ?, thumb_state = 0, analyze_state = 0, thumb_v = thumb_v + 1 WHERE id = ?').run(json, json ? Date.now() : null, id)
    await this.thumbs.remove(id)
    await this.thumbnail(id, 'grid')
    this.cleanupCache = null
    this.emitChanged()
  }

  setFavorite(ids: number[], favorite: boolean): void {
    transaction(this.db, () => this.assets.setFavorite(ids, favorite))
    this.emitChanged()
  }

  setTrashed(ids: number[], trashed: boolean): void {
    transaction(this.db, () => {
      this.assets.setTrashed(ids, trashed)
      // versions follow their original
      const v = this.db.prepare('UPDATE assets SET trashed_at = ? WHERE version_of = ?')
      for (const id of ids) v.run(trashed ? Date.now() : null, id)
    })
    this.emitChanged()
  }

  /**
   * Permanently remove items from the internal trash: files go to the operating system trash
   * (recoverable there), then rows are deleted. Only items already in the internal trash are affected.
   */
  async emptyTrash(ids?: number[]): Promise<{ removed: number; failed: number }> {
    if (!this.opts.moveToSystemTrash) throw new Error('Action disponible uniquement dans l’application de bureau')
    const rows = (ids?.length
      ? this.db.prepare(`SELECT id, path, live_video, raw_companion FROM assets WHERE trashed_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : this.db.prepare('SELECT id, path, live_video, raw_companion FROM assets WHERE trashed_at IS NOT NULL').all()) as Array<{ id: number; path: string; live_video: string | null; raw_companion: string | null }>
    if (!rows.length) return { removed: 0, failed: 0 }
    const paths = rows.flatMap((r) => [r.path, ...(r.live_video ? [r.live_video] : []), ...(r.raw_companion ? [r.raw_companion] : [])])
    const failed = new Set(await this.opts.moveToSystemTrash(paths))
    const done = rows.filter((r) => !failed.has(r.path))
    transaction(this.db, () => {
      const del = this.db.prepare('DELETE FROM assets WHERE id = ? OR (hidden = 1 AND path IN (?, ?))')
      for (const r of done) del.run(r.id, r.live_video ?? '', r.raw_companion ?? '')
    })
    this.emitChanged()
    return { removed: done.length, failed: rows.length - done.length }
  }
}

/** Essential EXIF for files MyPhotos creates, copied from the source row. */
export function exifFromRow(ref: Row, comment: string): { IFD0: Record<string, string>; IFD2: Record<string, string>; IFD3?: Record<string, string> } {
  const tz = ref.tz_offset as number | null
  const d = new Date((ref.taken_at as number) + (tz ?? 0) * 60000)
  const p2 = (n: number): string => String(n).padStart(2, '0')
  const g = tz !== null
    ? { y: d.getUTCFullYear(), m: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }
    : { y: d.getFullYear(), m: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() }
  const ifd2: Record<string, string> = { DateTimeOriginal: `${g.y}:${p2(g.m)}:${p2(g.d)} ${p2(g.h)}:${p2(g.mi)}:${p2(g.s)}`, UserComment: comment }
  if (tz !== null) ifd2.OffsetTimeOriginal = `${tz >= 0 ? '+' : '-'}${p2(Math.floor(Math.abs(tz) / 60))}:${p2(Math.abs(tz) % 60)}`
  const ifd0: Record<string, string> = { Software: 'MyPhotos' }
  if (ref.make) ifd0.Make = String(ref.make)
  if (ref.model) ifd0.Model = String(ref.model)
  if (typeof ref.lat === 'number' && typeof ref.lon === 'number') {
    const dms = (v: number): string => {
      const a = Math.abs(v)
      const dd = Math.floor(a)
      const mm = Math.floor((a - dd) * 60)
      return `${dd}/1 ${mm}/1 ${Math.round(((a - dd) * 60 - mm) * 6000)}/100`
    }
    return { IFD0: ifd0, IFD2: ifd2, IFD3: { GPSLatitudeRef: ref.lat >= 0 ? 'N' : 'S', GPSLatitude: dms(ref.lat), GPSLongitudeRef: ref.lon >= 0 ? 'E' : 'W', GPSLongitude: dms(ref.lon) } }
  }
  return { IFD0: ifd0, IFD2: ifd2 }
}

/** 0..1 technical quality: sharpness dominates, then exposure, then resolution. */
export function qualityScore(sharpness: number, brightness: number, clipDark: number, clipBright: number, megapixels: number): number {
  const sharp = Math.max(0, Math.min(1, (Math.log10(sharpness + 1) - 1) / 2.2))
  const exposure = Math.max(0, 1 - Math.abs(brightness - 0.47) * 1.6 - Math.max(0, clipDark - 0.05) * 2 - Math.max(0, clipBright - 0.03) * 3)
  const res = Math.max(0, Math.min(1, Math.log2(Math.max(1, megapixels)) / 5))
  return Math.round((sharp * 0.6 + exposure * 0.3 + res * 0.1) * 1000) / 1000
}

export function decodeInput(row: Row): DecodeInput {
  return {
    path: row.path as string,
    ext: row.ext as string,
    kind: row.kind as AssetKind,
    orientation: row.orientation as number | null,
    duration: row.duration as number | null
  }
}

/** Run meta + thumbnail indexing to completion, used by tests and CLI tools. */
export async function indexAll(lib: Library): Promise<void> {
  await lib.kickIndexer()
}

