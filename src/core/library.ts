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
import sharp from 'sharp'
import { SHARP_EXTS } from './media/kinds'
import { buildCleanupReport } from './cleanup'
import { analyzeImage } from './media/analyze'
import { ThumbStore, type ThumbSize } from './media/thumbs'
import { limiter, throttle } from './util'
import { runExport, type ExportRunner } from './export/exporter'
import { isAbsolute, relative as relPath } from 'node:path'
import type { DecodeInput } from './media/decode'
import type { AssetKind, CleanupReport, ExportOptions, JobGroupState, LibraryState, ServerEvent, Source } from '@shared/types'

export interface LibraryOptions {
  dataDir: string
  /** disable background indexing (tests) */
  autoIndex?: boolean
  watch?: boolean
  /** Move files to the OS trash; returns the paths that failed. Provided by the Electron host. */
  moveToSystemTrash?: (paths: string[]) => Promise<string[]>
}

type Stage = 'meta' | 'thumb' | 'analyze'

const STAGE_LABEL: Record<Stage, string> = {
  meta: 'Lecture des métadonnées',
  thumb: 'Création des miniatures',
  analyze: 'Analyse des images'
}

export class Library extends EventEmitter {
  readonly db: Db
  readonly assets: AssetRepo
  readonly albums: AlbumRepo
  readonly thumbs: ThumbStore
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
  }

  async start(): Promise<void> {
    this.retryFailuresAfterUpgrade()
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
      } while (this.indexAgain && !this.closed)
    })().finally(() => {
      this.indexing = null
    })
    return this.indexing
  }

  private static PENDING: Record<Stage, string> = {
    meta: 'meta_state = 0 AND missing_at IS NULL',
    thumb: 'thumb_state = 0 AND meta_state <> 0 AND hidden = 0 AND missing_at IS NULL',
    analyze: 'analyze_state = 0 AND thumb_state = 1 AND hidden = 0 AND missing_at IS NULL'
  }

  private pendingCount(stage: Stage): number {
    return (this.db.prepare(`SELECT count(*) AS n FROM assets WHERE ${Library.PENDING[stage]}`).get() as { n: number }).n
  }

  private async runStage(stage: Stage): Promise<void> {
    const concurrency = stage === 'thumb' ? Math.max(2, Math.floor(cpus().length / 2)) : Math.max(4, cpus().length)
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
              const ok = stage === 'meta' ? await this.indexMeta(row) : stage === 'thumb' ? await this.indexThumb(row) : await this.indexAnalysis(row)
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
      return true
    } catch {
      this.db.prepare('UPDATE assets SET meta_state = 2 WHERE id = ?').run(id)
      return false
    }
  }

  async indexThumb(row: Row): Promise<boolean> {
    const id = row.id as number
    try {
      const r = await this.thumbs.generate(id, decodeInput(row), 'grid')
      this.markThumb(row, r.width / r.height)
      return true
    } catch {
      this.db.prepare('UPDATE assets SET thumb_state = 2 WHERE id = ?').run(id)
      return false
    }
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
    const known = row.ratio as number | null
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
      const r = await this.thumbs.generate(id, decodeInput(row), size, 'interactive')
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
    this.cleanupCache = buildCleanupReport(this.db, this.version)
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

  setFavorite(ids: number[], favorite: boolean): void {
    transaction(this.db, () => this.assets.setFavorite(ids, favorite))
    this.emitChanged()
  }

  setTrashed(ids: number[], trashed: boolean): void {
    transaction(this.db, () => this.assets.setTrashed(ids, trashed))
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

