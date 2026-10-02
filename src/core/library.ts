import { EventEmitter } from 'node:events'
import { mkdirSync } from 'node:fs'
import { stat, statfs } from 'node:fs/promises'
import { cpus, userInfo } from 'node:os'
import { execFileSync } from 'node:child_process'
import { join, resolve, sep } from 'node:path'
import { openDb, transaction, type Db, type Row } from './db'
import { AssetRepo } from './repo/assets'
import { AlbumRepo } from './repo/albums'
import { ShareRepo } from './repo/shares'
import { Household } from './household'
import { applyChanges, pairLivePhotos, scanSource, type Shortcut } from './scan/scanner'
import { FolderWatcher } from './scan/watcher'
import { readMetadata } from './media/metadata'
import { fullHash, quickHash } from './media/hash'
import { fuseInWorker, renderInWorker } from './edit/runInWorker'
import { parseEdit } from './edit/render'
import { normalizeEdit, isNeutral, type PhotoEdit } from '@shared/edit/types'
import { mkdir as mkdirAsync } from 'node:fs/promises'
import { existsSync } from 'node:fs'
import sharp from 'sharp'
import { RAW_EXTS, SHARP_EXTS } from './media/kinds'
import { MlService } from './ml/service'
import { applyMomentPlan } from './organize/moments'
import { DbTaskRunner } from './dbTasks'
import { getLocale, localeTag, resolveLocale, setLocale, t, tn, type LocalePref } from '@shared/i18n'
import { paginate, syncMemories } from './organize/memories'
import { enrichWithClaude } from './organize/claudeTitles'
import { applyMovePlan, buildMovePlan, type MovePlan } from './organize/folders'
import { thumbKey, toTile } from './repo/assets'
import { Geocoder } from './geo'
import { analyzeImage, focalPoint } from './media/analyze'
import { ThumbStore, type ThumbSize } from './media/thumbs'
import { limiter, throttle } from './util'
import { runExport, runFfmpeg, type ExportRunner } from './export/exporter'
import { planVideoEdit } from './edit/videoRender'
import { renderRetrospective } from './export/retrospective'
import type { VideoEdit } from '@shared/edit/video'
import { tmpdir } from 'node:os'
import { rm as rmAsync } from 'node:fs/promises'
import { isAbsolute, relative as relPath } from 'node:path'
import type { DecodeInput } from './media/decode'
import type { AssetKind, CleanupReport, ExportOptions, RetroOptions, MemoryDetail, MemorySummary, MemoryTheme, MomentSummary, SearchHit, JobGroupState, LibraryState, ServerEvent, Source } from '@shared/types'

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
  /** Render a page of the app to PDF (Electron host). Returns the written file path. */
  printPdf?: (url: string, outFile: string, format: 'square' | 'a4' | 'large') => Promise<string>
  /** URL of the running app, used to render pages (set once the server listens) */
  appUrl?: () => string
  /** the launcher's machine-wide household pre-setting (foyer.local.json), read only; absent in tests */
  householdPreset?: string | null
  /** free space below which HDR fusions skip their 16-bit master (default 5 GB; tests set 0) */
  masterMinFree?: number
}

type Stage = 'meta' | 'thumb' | 'analyze' | 'ml'

/** below this much free space, HDR fusions skip their 16-bit master (about 70 MB each) and write the JPEG only */
const MASTER_MIN_FREE = 5 * 1024 ** 3

const stageLabel = (stage: Stage): string =>
  stage === 'meta' ? t('Lecture des métadonnées') : stage === 'thumb' ? t('Création des miniatures') : stage === 'analyze' ? t('Analyse des images') : t('Reconnaissance des visages et du contenu')

export class Library extends EventEmitter {
  readonly db: Db
  readonly assets: AssetRepo
  readonly albums: AlbumRepo
  readonly shares: ShareRepo
  readonly household: Household
  readonly thumbs: ThumbStore
  readonly ml: MlService
  private geocoder: Geocoder | null | undefined
  private watcher: FolderWatcher | null
  private version = 1
  private scanning = false
  private indexing: Promise<void> | null = null
  private indexAgain = false
  private progress = new Map<string, JobGroupState>()
  private fusionQueue: Promise<void> = Promise.resolve()
  /** bumped by cancelFusions(): queued fusions of an older epoch are skipped */
  private fusionEpoch = 0
  private fusionAbort: AbortController | null = null
  private exports = new Map<string, ExportRunner>()
  private exportSeq = 0
  private closed = false
  private emitChanged = throttle(() => this.send({ type: 'library-changed', version: ++this.version }), 1000)
  private emitJobs = throttle(() => this.send({ type: 'jobs', jobs: this.jobs() }), 400)

  constructor(private opts: LibraryOptions) {
    super()
    mkdirSync(opts.dataDir, { recursive: true })
    this.db = openDb(join(opts.dataDir, 'library.db'))
    this.dbTasks = new DbTaskRunner(this.db, join(opts.dataDir, 'library.db'), opts.workerDir)
    this.applyLocale()
    this.assets = new AssetRepo(this.db)
    this.albums = new AlbumRepo(this.db)
    this.shares = new ShareRepo(this.db)
    this.household = new Household(this, opts.householdPreset ?? null)
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
    void this.household.touch().catch(() => undefined)
    this.ml.loadVectors()
    void this.ml.ensureStarted().then(() => this.kickIndexer())
    for (const s of this.sources()) {
      this.online.set(s.id, s.online)
      if (s.online) this.watcher?.add(s.path)
    }
    this.sourcePoll = setInterval(() => this.pollSources(), 15000)
    this.sourcePoll.unref?.()
    // spec/01 § 6: re-read the household folder every 20 to 30 s (members' names and object heads)
    this.householdPoll = setInterval(() => void this.household.refresh().catch(() => false), 30000)
    this.householdPoll.unref?.()
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
    if (this.sourcePoll) clearInterval(this.sourcePoll)
    if (this.householdPoll) clearInterval(this.householdPoll)
    void this.dbTasks.close()
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
      .all()
      .map((r) => ({ ...(r as unknown as Omit<Source, 'online'>), online: existsSync((r as { path: string }).path) }))
  }

  /**
   * A source whose folder is absent (external disk unplugged, NAS asleep) is offline, not emptied: its photos stay
   * in the library with their thumbnails. If a scan or the watcher already marked the whole folder missing when it
   * vanished, that last batch is restored; a later scan with the disk back reconciles real deletions.
   */
  private keepOfflineSource(sourceId: number): void {
    const r = this.db
      .prepare('UPDATE assets SET missing_at = NULL WHERE source_id = ? AND missing_at IS NOT NULL AND missing_at >= (SELECT max(missing_at) FROM assets WHERE source_id = ?) - 120000')
      .run(sourceId, sourceId)
    if (Number(r.changes) > 0) this.emitChanged()
  }

  private online = new Map<number, boolean>()
  private sourcePoll: ReturnType<typeof setInterval> | null = null
  private householdPoll: ReturnType<typeof setInterval> | null = null

  /** Rescan when an offline source comes back (disk plugged in again) and refresh the UI when one goes away. */
  private pollSources(): void {
    let back = false
    let changed = false
    for (const s of this.sources()) {
      const was = this.online.get(s.id)
      if (was === s.online) continue
      this.online.set(s.id, s.online)
      if (was === undefined) continue
      changed = true
      if (s.online) {
        back = true
        this.watcher?.add(s.path)
      }
    }
    if (back) void this.rescanAll()
    else if (changed) this.emitChanged()
  }

  async addSource(path: string): Promise<Source> {
    const abs = resolve(path)
    const st = await stat(abs)
    if (!st.isDirectory()) throw new Error(t('Ce chemin n’est pas un dossier'))
    const overlapping = this.sources().find((s) => abs.startsWith(s.path + '/') || abs.startsWith(s.path + '\\') || s.path.startsWith(abs + '/') || s.path.startsWith(abs + '\\') || s.path === abs)
    if (overlapping) throw new Error(t('Ce dossier recoupe une source existante : {path}', { path: overlapping.path }))
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
          if (!s.online) {
            this.keepOfflineSource(s.id)
            continue
          }
          const r = await scanSource(this.db, s.id, s.path)
          this.syncAliasAlbums(r.shortcuts)
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

  /**
   * A folder of Finder aliases (for example albums exported from Apple Photos) becomes a MyPhotos album named after
   * the folder. Each alias is taken into account once: photos removed from the album, or an album deleted by the user,
   * stay that way. Nothing is written on disk. Returns the number of photos added to albums.
   */
  syncAliasAlbums(shortcuts: Shortcut[]): number {
    if (!shortcuts.length) return 0
    const known = this.db.prepare('SELECT 1 FROM alias_links WHERE alias_path = ?')
    const fresh = shortcuts.filter((sc) => sc.target && !known.get(sc.path))
    if (!fresh.length) return 0
    const byPath = this.db.prepare('SELECT id, hidden, source_id, rel_dir, stem FROM assets WHERE path = ? AND missing_at IS NULL')
    const mainOf = this.db.prepare('SELECT id FROM assets WHERE source_id = ? AND rel_dir = ? AND stem = ? AND hidden = 0 AND missing_at IS NULL LIMIT 1')
    const byFolder = new Map<string, number[]>()
    let added = 0
    transaction(this.db, () => {
      const link = this.db.prepare('INSERT OR IGNORE INTO alias_links (alias_path, folder, target) VALUES (?, ?, ?)')
      for (const sc of fresh) {
        const folder = sc.path.slice(0, Math.max(sc.path.lastIndexOf('/'), sc.path.lastIndexOf('\\')))
        const a = byPath.get(sc.target!) as { id: number; hidden: number; source_id: number; rel_dir: string; stem: string } | undefined
        // the target is not indexed (yet): leave the alias unlinked so a later scan retries
        if (!a) continue
        link.run(sc.path, folder, sc.target)
        const id = a.hidden ? ((mainOf.get(a.source_id, a.rel_dir, a.stem) as { id: number } | undefined)?.id ?? a.id) : a.id
        const list = byFolder.get(folder) ?? []
        list.push(id)
        byFolder.set(folder, list)
      }
      const getAlbum = this.db.prepare('SELECT album_id FROM alias_albums WHERE folder = ?')
      const setAlbum = this.db.prepare('INSERT INTO alias_albums (folder, album_id) VALUES (?, ?)')
      for (const [folder, ids] of [...byFolder].sort((x, y) => x[0].localeCompare(y[0], 'fr'))) {
        const row = getAlbum.get(folder) as { album_id: number | null } | undefined
        if (row) {
          if (row.album_id !== null && this.albums.get(row.album_id)) added += this.albums.addAssets(row.album_id, ids)
          continue
        }
        const name = folder.split(/[\\/]/).pop() || 'Album'
        const album = this.albums.create(name, 'manual', null, ids)
        setAlbum.run(folder, album.id)
        added += ids.length
      }
    })
    return added
  }

  private async onFsChanges(root: string, paths: string[]): Promise<void> {
    const s = this.sources().find((x) => x.path === root)
    if (!s || this.closed) return
    // the whole disk went away: not a deletion
    if (!s.online) {
      this.keepOfflineSource(s.id)
      return
    }
    const shortcuts: Shortcut[] = []
    const n = await applyChanges(this.db, s.id, s.path, paths, (sc) => shortcuts.push(sc))
    const linked = this.syncAliasAlbums(shortcuts)
    if (n > 0 || linked > 0) {
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
        await this.ensureMemories().catch(() => undefined)
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
    const group: JobGroupState = { id: stage, label: stageLabel(stage), total: this.pendingCount(stage), done: 0, failed: 0 }
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
      const thumb = this.thumbs.pathFor(id, 'grid')
      const [a, focal] = await Promise.all([analyzeImage(thumb), focalPoint(thumb).catch(() => ({ x: 0.5, y: 0.5 }))])
      const mp = ((row.width as number | null) ?? 0) * ((row.height as number | null) ?? 0) / 1e6
      this.db.prepare(`UPDATE assets SET phash = ?, ph0 = ?, ph1 = ?, ph2 = ?, ph3 = ?, sharpness = ?, brightness = ?, clip_dark = ?, clip_bright = ?,
          contrast = ?, quality = ?, analyze_state = 1,
          focal_x = CASE WHEN ml_state = 1 AND focal_x IS NOT NULL THEN focal_x ELSE ? END,
          focal_y = CASE WHEN ml_state = 1 AND focal_y IS NOT NULL THEN focal_y ELSE ? END WHERE id = ?`)
        .run(a.phash, a.bands[0], a.bands[1], a.bands[2], a.bands[3], a.sharpness, a.brightness, a.clipDark, a.clipBright, a.contrast,
          qualityScore(a.sharpness, a.brightness, a.clipDark, a.clipBright, mp), focal.x, focal.y, id)
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

  // ---------------------------------------------------------------- moments & memories

  private momentsVersion = -1
  private memoriesVersion = -1

  private momentsRunning: Promise<void> | null = null

  /** Rebuild moments when the library changed since the last build. Computed off-thread, only changed moments are written. */
  ensureMoments(): Promise<void> {
    if (this.momentsVersion === this.version) return Promise.resolve()
    if (this.momentsRunning) return this.momentsRunning
    const v = this.version
    this.momentsRunning = this.dbTasks
      .run({ task: 'moments' })
      .then((plan) => {
        if (this.closed) return
        applyMomentPlan(this.db, plan)
        this.momentsVersion = v
      })
      .finally(() => {
        this.momentsRunning = null
      })
    return this.momentsRunning
  }

  async moments(): Promise<MomentSummary[]> {
    await this.ensureMoments()
    const rows = this.db.prepare('SELECT m.*, a.thumb_v, a.qhash FROM moments m LEFT JOIN assets a ON a.id = m.cover_id ORDER BY m.start_at DESC').all() as Row[]
    return rows.map((r) => ({
      id: r.id as number, title: r.title as string, subtitle: r.subtitle as string | null, dayStart: r.day_start as string, dayEnd: r.day_end as string,
      city: r.city as string | null, country: r.country as string | null, count: r.n as number, coverId: r.cover_id as number | null,
      coverV: r.cover_id ? thumbKey(r) : '', tripId: r.trip_id as number | null
    }))
  }

  async renameMoment(id: number, title: string): Promise<void> {
    const m = this.db.prepare('SELECT sig FROM moments WHERE id = ?').get(id) as { sig: string } | undefined
    if (!m) return
    const t = title.trim()
    if (t) {
      this.db.prepare('INSERT INTO moment_titles (sig, title) VALUES (?, ?) ON CONFLICT(sig) DO UPDATE SET title = excluded.title').run(m.sig, t)
      this.db.prepare('UPDATE moments SET title = ? WHERE id = ?').run(t, id)
    } else {
      this.db.prepare('DELETE FROM moment_titles WHERE sig = ?').run(m.sig)
      this.momentsVersion = -1
      await this.ensureMoments()
    }
    this.emitChanged()
  }

  /** Propose and store memories; runs after moments when the library changed. */
  private memoriesAt = 0
  private memoriesRunning: Promise<void> | null = null

  /** Propose memories at most once a minute while the library keeps changing (indexing). */
  async ensureMemories(force = false): Promise<void> {
    if (this.memoriesRunning) return this.memoriesRunning
    if (this.memoriesVersion === this.version) return
    if (!force && Date.now() - this.memoriesAt < 60000 && this.memoriesVersion !== -1) return
    this.memoriesRunning = this.buildMemories().finally(() => {
      this.memoriesRunning = null
    })
    return this.memoriesRunning
  }

  private async buildMemories(): Promise<void> {
    await this.ensureMoments()
    this.memoriesVersion = this.version
    this.memoriesAt = Date.now()
    const drafts = await this.dbTasks.run({ task: 'memories', now: Date.now() })
    const changed = await syncMemories(this.db, drafts, (id) => this.thumbs.pathFor(id, 'grid'))
    if (changed) this.emitChanged()
  }

  private memoryRow(r: Row): MemorySummary {
    const cover = r.cover_id ? this.assets.raw(r.cover_id as number) : undefined
    const ids = JSON.parse(r.asset_ids as string) as number[]
    return {
      id: r.id as number, kind: r.kind as MemorySummary['kind'], title: r.title as string, subtitle: r.subtitle as string | null,
      coverId: (r.cover_id as number | null) ?? null, coverV: cover ? thumbKey(cover) : '', count: ids.length, pinned: r.pinned === 1,
      albumId: (r.album_id as number | null) ?? null, theme: r.theme ? (JSON.parse(r.theme as string) as MemoryTheme) : { accent: '#1f2937', onAccent: 'light', bg: '#111113' },
      createdAt: r.created_at as number
    }
  }

  memories(): MemorySummary[] {
    const rows = this.db.prepare('SELECT * FROM memories WHERE dismissed = 0 ORDER BY pinned DESC, created_at DESC, id DESC').all() as Row[]
    return rows.map((r) => this.memoryRow(r))
  }

  memory(id: number): MemoryDetail | null {
    const r = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
    if (!r) return null
    const s = this.memoryRow(r)
    const ids = (JSON.parse(r.asset_ids as string) as number[])
    const rows = this.db.prepare(`SELECT id, kind, ratio, taken_at, duration, is_live, favorite, is_raw, thumb_v, qhash, focal_x, focal_y, (edit IS NOT NULL) AS edited, 0 AS versions, quality, favorite AS fav
        FROM assets WHERE id IN (SELECT value FROM json_each(?)) AND missing_at IS NULL AND trashed_at IS NULL`).all(JSON.stringify(ids)) as Row[]
    const byId = new Map(rows.map((x) => [x.id as number, x]))
    const live = ids.filter((i) => byId.has(i))
    const tiles = live.map((i) => toTile(byId.get(i)!))
    const pages = paginate(live.map((i) => ({ id: i, ratio: (byId.get(i)!.ratio as number | null) ?? 1.5, score: ((byId.get(i)!.quality as number | null) ?? 0) + (byId.get(i)!.fav === 1 ? 0.3 : 0) })), s.title, s.subtitle)
    return { ...s, assetIds: live, pages, tiles }
  }

  updateMemory(id: number, patch: { title?: string; subtitle?: string | null; pinned?: boolean; dismissed?: boolean; assetIds?: number[]; coverId?: number }): void {
    const r = this.db.prepare('SELECT * FROM memories WHERE id = ?').get(id) as Row | undefined
    if (!r) return
    // a title chosen by the user (or Claude) no longer follows the generated one
    const retitled = (patch.title?.trim() && patch.title.trim() !== r.title) || (patch.subtitle !== undefined && patch.subtitle !== r.subtitle)
    if (retitled) this.db.prepare('UPDATE memories SET auto_title = 0 WHERE id = ?').run(id)
    this.db.prepare('UPDATE memories SET title = ?, subtitle = ?, pinned = ?, dismissed = ?, asset_ids = ?, cover_id = ?, updated_at = ? WHERE id = ?').run(
      patch.title?.trim() || (r.title as string), patch.subtitle === undefined ? (r.subtitle as string | null) : patch.subtitle,
      patch.pinned === undefined ? (r.pinned as number) : patch.pinned ? 1 : 0, patch.dismissed === undefined ? (r.dismissed as number) : patch.dismissed ? 1 : 0,
      patch.assetIds ? JSON.stringify(patch.assetIds) : (r.asset_ids as string), patch.coverId ?? (r.cover_id as number | null), Date.now(), id)
    this.emitChanged()
  }

  /** Save a memory as a real album (kept in sync by id). */
  saveMemoryAsAlbum(id: number): number {
    const r = this.db.prepare('SELECT title, asset_ids, album_id FROM memories WHERE id = ?').get(id) as { title: string; asset_ids: string; album_id: number | null } | undefined
    if (!r) throw new Error(t('Souvenir introuvable'))
    if (r.album_id && this.albums.get(r.album_id)) return r.album_id
    const a = this.albums.create(r.title, 'manual', null, JSON.parse(r.asset_ids) as number[])
    this.db.prepare('UPDATE memories SET album_id = ? WHERE id = ?').run(a.id, id)
    this.emitChanged()
    return a.id
  }

  /** Regenerate the selection of an automatic memory. */
  async regenerateMemory(id: number): Promise<void> {
    const r = this.db.prepare('SELECT key FROM memories WHERE id = ?').get(id) as { key: string } | undefined
    if (!r) return
    const d = (await this.dbTasks.run({ task: 'memories', now: Date.now() })).find((x) => x.key === r.key)
    if (!d) return
    this.db.prepare('UPDATE memories SET asset_ids = ?, cover_id = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(d.ids), d.coverId, Date.now(), id)
    this.emitChanged()
  }

  /** Ask Claude for a better title (opt-in, needs an API key in settings). */
  async enrichMemory(id: number): Promise<{ title: string; subtitle: string }> {
    const key = this.setting('anthropic_api_key')
    if (!key) throw new Error(t('Ajoutez une clé API Claude dans les réglages pour activer cette fonction'))
    const m = this.memory(id)
    if (!m) throw new Error(t('Souvenir introuvable'))
    const ids = m.assetIds
    const places = (this.db.prepare(`SELECT place_city AS c, count(*) AS n FROM assets WHERE id IN (SELECT value FROM json_each(?)) AND place_city IS NOT NULL GROUP BY 1 ORDER BY n DESC LIMIT 4`).all(JSON.stringify(ids)) as Array<{ c: string }>).map((r) => r.c)
    const people = (this.db.prepare(`SELECT DISTINCT p.name FROM faces f JOIN persons p ON p.id = f.person_id WHERE p.name IS NOT NULL AND f.asset_id IN (SELECT value FROM json_each(?)) LIMIT 6`).all(JSON.stringify(ids)) as Array<{ name: string }>).map((r) => r.name)
    const days = (this.db.prepare(`SELECT min(day) AS a, max(day) AS b FROM assets WHERE id IN (SELECT value FROM json_each(?))`).get(JSON.stringify(ids)) as { a: string; b: string })
    const thumbs: string[] = []
    for (const aid of [m.coverId ?? ids[0]!, ...ids.filter((x) => x !== m.coverId).slice(0, 5)]) {
      const f = await this.thumbnail(aid, 'grid')
      if (f) thumbs.push(f)
    }
    const r = await enrichWithClaude(key, { kind: m.kind, currentTitle: m.title, subtitle: m.subtitle, places, people, dateRange: `${days.a} → ${days.b}`, count: ids.length, thumbs })
    this.updateMemory(id, { title: r.title, subtitle: r.subtitle })
    return { title: r.title, subtitle: r.subtitle }
  }

  async printMemoryPdf(id: number, title: string, format: 'square' | 'a4' | 'large'): Promise<string> {
    if (!this.opts.printPdf || !this.opts.appUrl) throw new Error(t('Export PDF disponible uniquement dans l’application de bureau'))
    await mkdirAsync(this.creationsDir, { recursive: true })
    const safe = title.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80)
    let out = join(this.creationsDir, `${safe}.pdf`)
    for (let i = 2; existsSync(out); i++) out = join(this.creationsDir, `${safe} (${i}).pdf`)
    return this.opts.printPdf(`${this.opts.appUrl()}&print=memory:${id}&format=${format}`, out, format)
  }

  /** Preview of the folder arrangement for one source (nothing is moved). */
  async movePlan(sourceId: number): Promise<MovePlan & { sourcePath: string }> {
    await this.ensureMoments()
    const src = this.sources().find((s) => s.id === sourceId)
    if (!src) throw new Error(t('Dossier introuvable'))
    return { ...buildMovePlan(this.db, sourceId), sourcePath: src.path }
  }

  /** Move the files of a source into Year/Month Moment folders. Explicit user action, progress as a job. */
  async startMove(sourceId: number): Promise<string> {
    const plan = await this.movePlan(sourceId)
    const jobId = `move-${++this.exportSeq}`
    const group: JobGroupState = { id: jobId, label: t('Rangement des fichiers'), total: plan.items.length, done: 0, failed: 0 }
    this.progress.set(jobId, group)
    this.emitJobs()
    void applyMovePlan(this.db, plan.items, (done) => {
      group.done = done
      this.emitJobs()
    })
      .then((r) => {
        group.failed = r.failed.length
        this.send({ type: 'creation-done', ok: r.failed.length === 0, assetId: null, error: r.failed.length ? tn(r.failed.length, '{n} fichier non déplacé : {error}', '{n} fichiers non déplacés : {error}', { error: r.failed[0]!.error }) : undefined, sources: [] })
      })
      .finally(() => {
        this.progress.delete(jobId)
        this.emitJobs()
        this.emitChanged()
      })
    return jobId
  }

  // ---------------------------------------------------------------- family sharing

  /** <first library folder>/Partagés/<album>: the only place MyPhotos writes into the user's folders. */
  sharedUploadDir(albumName: string): string | null {
    const creations = this.creationsDir
    const src = this.sources().find((s) => s.path !== creations)
    return src ? join(src.path, 'Partagés', sanitizeName(albumName) || 'Album') : null
  }

  /** Index files a guest uploaded and add them to the shared album. */
  async addSharedUploads(albumId: number, paths: string[], author: string): Promise<void> {
    if (!paths.length) return
    const src = this.sources().find((s) => paths[0]!.startsWith(s.path))
    if (!src) return
    await applyChanges(this.db, src.id, src.path, paths)
    const ids: number[] = []
    for (const p of paths) {
      const r = this.db.prepare('SELECT * FROM assets WHERE path = ?').get(p) as Row | undefined
      if (!r) continue
      await this.indexMeta(r)
      ids.push(r.id as number)
      this.shares.recordUpload(p, albumId, author)
    }
    this.albums.addAssets(albumId, ids)
    for (const id of ids) void this.thumbnail(id, 'grid')
    this.shareActivity(albumId, 'upload', author)
    if (this.opts.autoIndex !== false) void this.kickIndexer()
  }

  shareActivity(albumId: number, kind: 'comment' | 'upload' | 'like', author: string): void {
    const a = this.albums.get(albumId)
    if (!a) return
    this.send({ type: 'share-activity', albumId, albumName: a.name, kind, author })
    this.emitChanged()
  }

  /**
   * Language of generated content (moment and memory titles, job labels, messages). The app reports the user's
   * preference and the system language at startup; until then French, the source language.
   */
  private applyLocale(): boolean {
    const r = resolveLocale(this.setting('locale') as LocalePref | null, this.setting('locale_system') ?? 'fr-FR')
    if (r.locale === getLocale() && r.tag === localeTag()) return false
    setLocale(r.locale, r.tag)
    return true
  }

  setLocalePref(pref: LocalePref, system: string): void {
    this.setSetting('locale', pref === 'auto' ? null : pref)
    this.setSetting('locale_system', system.slice(0, 35))
    if (this.applyLocale()) {
      // generated text follows the language: moment and memory titles, cleanup reasons
      this.momentsVersion = -1
      this.memoriesVersion = -1
      this.invalidateCleanup()
      void this.ensureMemories(true).catch(() => undefined)
      this.emitChanged()
    }
  }

  get ownerName(): string {
    return this.setting('owner_name') ?? (this.defaultOwner ??= systemFirstName())
  }
  private defaultOwner?: string

  /** Where HDR fusions put their 16-bit TIFF masters: the creations folder unless another one was chosen. */
  get mastersDir(): string {
    return this.setting('hdr_masters_dir') ?? this.creationsDir
  }

  /** Choose the masters folder (null: back to the creations folder). Never inside a library folder: originals stay untouched. */
  setMastersDir(dir: string | null): void {
    if (dir !== null) {
      const abs = resolve(dir)
      const inside = this.sources().some((s) => s.path !== this.creationsDir && (abs === s.path || abs.startsWith(s.path + sep)))
      if (inside) throw new Error(t('Choisissez un dossier en dehors de vos dossiers de photos.'))
      dir = abs === this.creationsDir ? null : abs
    }
    this.setSetting('hdr_masters_dir', dir)
  }

  setting(key: string): string | null {
    return (this.db.prepare('SELECT value FROM settings WHERE key = ?').get(key) as { value: string } | undefined)?.value ?? null
  }

  setSetting(key: string, value: string | null): void {
    if (value === null) this.db.prepare('DELETE FROM settings WHERE key = ?').run(key)
    else this.db.prepare('INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value').run(key, value)
  }

  // ---------------------------------------------------------------- cleanup

  private cleanupCache: CleanupReport | null = null
  private dbTasks: DbTaskRunner

  private cleanupRunning: Promise<CleanupReport> | null = null
  private cleanupEpoch = 0

  private invalidateCleanup(): void {
    this.cleanupCache = null
    this.cleanupEpoch++
  }

  /** Cached per library version; computed off-thread (seconds at 200k). Callers during a computation share it. */
  cleanupReport(): Promise<CleanupReport> {
    if (this.cleanupCache && this.cleanupCache.version === this.version) return Promise.resolve(this.cleanupCache)
    if (this.cleanupRunning) return this.cleanupRunning
    const epoch = this.cleanupEpoch
    this.cleanupRunning = this.dbTasks
      .run({ task: 'cleanup', version: this.version, creationsSource: this.creationsSourceId() })
      .then((r) => {
        // a trash or keep action during the computation makes this result stale
        if (epoch === this.cleanupEpoch) this.cleanupCache = r
        return r
      })
      .finally(() => {
        this.cleanupRunning = null
      })
    return this.cleanupRunning
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
    this.invalidateCleanup()
    this.emitChanged()
  }

  get dataDir(): string {
    return this.opts.dataDir
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
    if (rows.length < 2) throw new Error(t('Choisissez au moins deux photos de la même scène'))
    // one fusion at a time: each holds the decoded series in memory (hundreds of MB at 4096 px),
    // and "fuse all" on a large library would otherwise start them all at once
    const jobId = 'fusion'
    const group = this.progress.get(jobId) ?? { id: jobId, label: t('Fusion des expositions'), total: 0, done: 0, failed: 0, cancellable: true }
    group.total++
    this.progress.set(jobId, group)
    this.exports.set(jobId, { result: Promise.resolve(null as never), cancel: () => this.cancelFusions() })
    this.emitJobs()
    const epoch = this.fusionEpoch
    this.fusionQueue = this.fusionQueue.then(async () => {
      if (epoch !== this.fusionEpoch) {
        this.send({ type: 'creation-done', ok: false, cancelled: true, assetId: null, sources: ids })
        return
      }
      let assetId: number | null = null
      let out: string | null = null
      let master: string | null = null
      let warning: string | undefined
      const abort = (this.fusionAbort = new AbortController())
      try {
        const sourceId = await this.ensureCreationsSource()
        const ref = [...rows].sort((a, b) => (a.exposure as number) - (b.exposure as number))[Math.floor(rows.length / 2)]!
        const stem = String(ref.name).replace(/\.[^.]+$/, '')
        let name = `${stem} HDR`
        for (let i = 2; existsSync(join(this.creationsDir, `${name}.jpg`)) || existsSync(join(this.creationsDir, `${name}.tif`)); i++) name = `${stem} HDR ${i}`
        out = join(this.creationsDir, `${name}.jpg`)
        // the masters folder may be on an external disk: no master while it is unplugged
        const mastersDir = this.mastersDir
        const mastersHere = existsSync(mastersDir)
        master = join(mastersDir, `${name}.tif`)
        for (let i = 2; existsSync(master); i++) master = join(mastersDir, `${name} (${i}).tif`)
        const exif = exifFromRow(ref, 'MyPhotos HDR')
        // frames shot RAW + JPEG are developed from the RAW: the sensor's range, and a 16-bit master for grading
        const raws = rows.map((r) => (RAW_EXTS.has(String(r.ext)) ? String(r.path) : (r.raw_companion as string | null)))
        const fromRaw = raws.every((p): p is string => Boolean(p) && existsSync(p!))
        const fs = mastersHere ? await statfs(mastersDir) : null
        const roomForMaster = fs !== null && fs.bavail * fs.bsize >= (this.opts.masterMinFree ?? MASTER_MIN_FREE)
        if (fromRaw && !mastersHere) warning = t('Photo HDR créée sans master 16 bits : le dossier des masters est introuvable (disque débranché ?).')
        else if (fromRaw && !roomForMaster) warning = t('Photo HDR créée sans master 16 bits : il reste moins de 5 Go sur le disque.')
        const res = await fuseInWorker({ inputs: rows.map(decodeInput), raws: fromRaw ? raws : undefined, output: out, master: roomForMaster ? master : undefined, maxSize: 4096, align: true, exif }, undefined, abort.signal)
        const now = Date.now()
        this.db.prepare('INSERT OR REPLACE INTO creations (path, kind, sources, created_at) VALUES (?, ?, ?, ?)').run(out, 'hdr', JSON.stringify(ids), now)
        if (res.master) this.db.prepare('INSERT OR REPLACE INTO creations (path, kind, sources, created_at) VALUES (?, ?, ?, ?)').run(res.master, 'hdr-master', JSON.stringify(ids), now)
        // a master inside the creations folder is indexed (as a hidden version of the JPEG); elsewhere it is only a file
        await applyChanges(this.db, sourceId, this.creationsDir, res.master && mastersDir === this.creationsDir ? [out, res.master] : [out])
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
        this.invalidateCleanup()
        this.emitChanged()
        this.send({ type: 'creation-done', ok: true, assetId, sources: ids, warning })
      } catch (e) {
        if (abort.signal.aborted) {
          // stopped mid-way: the half-written result is MyPhotos' own file, never a source
          for (const f of [out, master]) if (f && existsSync(f)) await rmAsync(f, { force: true }).catch(() => undefined)
          this.send({ type: 'creation-done', ok: false, cancelled: true, assetId: null, sources: ids })
          return
        }
        group.failed++
        this.send({ type: 'creation-done', ok: false, assetId: null, error: (e as Error).message, sources: ids })
      } finally {
        if (this.fusionAbort === abort) this.fusionAbort = null
        if (epoch === this.fusionEpoch) {
          group.done++
          if (group.done >= group.total) {
            this.progress.delete(jobId)
            this.exports.delete(jobId)
          }
          this.emitJobs()
        }
      }
    })
    return jobId
  }

  /** Stop the running fusion and drop the queued ones; finished fusions are kept. */
  cancelFusions(): void {
    this.fusionEpoch++
    this.fusionAbort?.abort()
    this.progress.delete('fusion')
    this.exports.delete('fusion')
    this.emitJobs()
  }

  /**
   * Save the edits as a new full-resolution JPEG, stacked under the original as a version
   * (one item in the grid). The original file and its own settings are left untouched.
   */
  startEditedCopy(id: number, edit: PhotoEdit): string {
    const row = this.assets.raw(id)
    if (!row || row.kind !== 'photo') throw new Error(t('Photo introuvable'))
    const main = (row.version_of as number | null) ?? id
    const jobId = `copy-${++this.exportSeq}`
    this.progress.set(jobId, { id: jobId, label: t('Enregistrement de la copie'), total: 1, done: 0, failed: 0 })
    this.emitJobs()
    void (async () => {
      try {
        const sourceId = await this.ensureCreationsSource()
        const stem = String(row.name).replace(/\.[^.]+$/, '')
        let out = join(this.creationsDir, `${stem} (${t('copie modifiée')}).jpg`)
        for (let i = 2; existsSync(out); i++) out = join(this.creationsDir, `${stem} (${t('copie modifiée')} ${i}).jpg`)
        await renderInWorker({ input: decodeInput(row), edit: normalizeEdit(edit), output: out, quality: 95, exif: exifFromRow(row, t('MyPhotos copie modifiée')) })
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

  /** Render a retrospective video into the creations folder. */
  startRetrospective(opts: RetroOptions): string {
    const jobId = `retro-${++this.exportSeq}`
    const group: JobGroupState = { id: jobId, label: opts.preview ? t('Aperçu de la vidéo souvenir') : t('Vidéo souvenir'), total: 100, done: 0, failed: 0, progress: 0, cancellable: true }
    this.progress.set(jobId, group)
    this.emitJobs()
    const ctrl = new AbortController()
    this.exports.set(jobId, { result: Promise.resolve(null as never), cancel: () => ctrl.abort() })
    void (async () => {
      let out = ''
      try {
        const sourceId = await this.ensureCreationsSource()
        const base = (opts.title?.trim() || t('Rétrospective')).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').slice(0, 80)
        const dir = opts.preview ? join(this.opts.dataDir, 'cache', 'previews') : this.creationsDir
        await mkdirAsync(dir, { recursive: true })
        out = join(dir, `${base}${opts.preview ? ` (${t('aperçu')})` : ''}.mp4`)
        for (let i = 2; !opts.preview && existsSync(out); i++) out = join(dir, `${base} ${i}.mp4`)
        await renderRetrospective(this.db, opts, out, (f) => {
          group.progress = f
          group.done = Math.round(f * 100)
          this.emitJobs()
        }, ctrl.signal)
        let assetId: number | null = null
        if (!opts.preview) {
          this.db.prepare('INSERT OR REPLACE INTO creations (path, kind, sources, created_at) VALUES (?, ?, ?, ?)').run(out, 'retrospective', '[]', Date.now())
          await applyChanges(this.db, sourceId, this.creationsDir, [out])
          const r = this.db.prepare('SELECT * FROM assets WHERE path = ?').get(out) as Row | undefined
          if (r) {
            await this.indexMeta(r)
            await this.indexThumb(this.assets.raw(r.id as number)!)
            assetId = r.id as number
          }
          this.emitChanged()
        }
        this.send({ type: 'retro-done', ok: true, assetId, preview: opts.preview === true, file: out })
      } catch (e) {
        this.send({ type: 'retro-done', ok: false, assetId: null, preview: opts.preview === true, file: null, error: ctrl.signal.aborted ? t('annulé') : (e as Error).message })
      } finally {
        this.exports.delete(jobId)
        this.progress.delete(jobId)
        this.emitJobs()
      }
    })()
    return jobId
  }

  /** Render an edited copy of a video into the creations folder; the original is only read. */
  startVideoEdit(id: number, edit: VideoEdit): string {
    const row = this.assets.raw(id)
    if (!row || row.kind !== 'video') throw new Error(t('Vidéo introuvable'))
    const jobId = `video-${++this.exportSeq}`
    const group: JobGroupState = { id: jobId, label: t('Montage de {name}', { name: row.name as string }), total: 1, done: 0, failed: 0, progress: 0, cancellable: true }
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
        out = join(this.creationsDir, `${stem} (${t('modifiée')}).mp4`)
        for (let i = 2; existsSync(out); i++) out = join(this.creationsDir, `${stem} (${t('modifiée')} ${i}).mp4`)
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
        this.send({ type: 'creation-done', ok: false, assetId: null, error: ctrl.signal.aborted ? t('annulé') : (e as Error).message, sources: [id] })
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
    if (!isAbsolute(opts.destination)) throw new Error(t('Choisissez un dossier de destination'))
    const dest = resolve(opts.destination)
    for (const s of this.sources()) {
      const rel = relPath(s.path, dest)
      if (rel === '' || (!rel.startsWith('..') && !isAbsolute(rel))) throw new Error(t('Choisissez un dossier en dehors de la photothèque, sinon les fichiers exportés y seraient réimportés.'))
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
    const group: JobGroupState = { id: jobId, label: tn(n, 'Export de {n} élément', 'Export de {n} éléments'), total: n, done: 0, failed: 0, progress: 0, cancellable: true }
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
    if (!row || row.kind !== 'photo') throw new Error(t('Seules les photos peuvent être retouchées ici'))
    const e = edit ? normalizeEdit(edit) : null
    const json = e && !isNeutral(e) ? JSON.stringify(e) : null
    this.db.prepare('UPDATE assets SET edit = ?, edited_at = ?, thumb_state = 0, analyze_state = 0, thumb_v = thumb_v + 1 WHERE id = ?').run(json, json ? Date.now() : null, id)
    await this.thumbs.remove(id)
    await this.thumbnail(id, 'grid')
    this.invalidateCleanup()
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
    // cleanup depends on what is in the trash (a trashed HDR gives its series back)
    this.invalidateCleanup()
    this.emitChanged()
  }

  /**
   * Permanently remove items from the internal trash: files go to the operating system trash
   * (recoverable there), then rows are deleted. Only items already in the internal trash are affected.
   */
  async emptyTrash(ids?: number[]): Promise<{ removed: number; failed: number }> {
    if (!this.opts.moveToSystemTrash) throw new Error(t('Action disponible uniquement dans l’application de bureau'))
    const rows = (ids?.length
      ? this.db.prepare(`SELECT id, path, live_video, raw_companion FROM assets WHERE trashed_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : this.db.prepare('SELECT id, path, live_video, raw_companion FROM assets WHERE trashed_at IS NOT NULL').all()) as Array<{ id: number; path: string; live_video: string | null; raw_companion: string | null }>
    if (!rows.length) return { removed: 0, failed: 0 }
    const paths = rows.flatMap((r) => [r.path, ...(r.live_video ? [r.live_video] : []), ...(r.raw_companion ? [r.raw_companion] : [])])
    const failed = new Set(await this.opts.moveToSystemTrash(paths))
    const done = rows.filter((r) => !failed.has(r.path))
    // masters kept outside the library (not indexed) follow their HDR JPEG
    const masters = this.db.prepare(`SELECT m.path FROM creations m JOIN creations c ON c.kind = 'hdr' AND c.sources = m.sources AND c.created_at = m.created_at
        WHERE m.kind = 'hdr-master' AND c.path = ? AND NOT EXISTS (SELECT 1 FROM assets a WHERE a.path = m.path)`)
    const loose = done.flatMap((r) => (masters.all(r.path) as Array<{ path: string }>).map((m) => m.path)).filter((p) => existsSync(p))
    const looseFailed = new Set(loose.length ? await this.opts.moveToSystemTrash(loose) : [])
    transaction(this.db, () => {
      const del = this.db.prepare('DELETE FROM assets WHERE id = ? OR (hidden = 1 AND path IN (?, ?))')
      for (const r of done) del.run(r.id, r.live_video ?? '', r.raw_companion ?? '')
      const delC = this.db.prepare('DELETE FROM creations WHERE path = ?')
      for (const p of loose) if (!looseFailed.has(p)) delC.run(p)
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

const sanitizeName = (s: string): string => s.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/, '').trim().slice(0, 80)

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


/** First name of the OS account ("Dimitri" rather than the login "dimitrisourzac"), best effort. */
function systemFirstName(): string {
  try {
    if (process.platform === 'darwin') {
      const full = execFileSync('id', ['-F'], { encoding: 'utf8', timeout: 2000 }).trim()
      if (full) return full.split(/\s+/)[0]!
    }
  } catch {
    // fall back to the login name
  }
  const login = process.env.USER || process.env.USERNAME || userInfo().username || 'MyPhotos'
  return login.charAt(0).toUpperCase() + login.slice(1)
}
