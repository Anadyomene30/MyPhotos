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
import { quickHash } from './media/hash'
import { ThumbStore, type ThumbSize } from './media/thumbs'
import { limiter, throttle } from './util'
import type { DecodeInput } from './media/decode'
import type { AssetKind, JobGroupState, LibraryState, ServerEvent, Source } from '@shared/types'

export interface LibraryOptions {
  dataDir: string
  /** disable background indexing (tests) */
  autoIndex?: boolean
  watch?: boolean
  /** Move files to the OS trash; returns the paths that failed. Provided by the Electron host. */
  moveToSystemTrash?: (paths: string[]) => Promise<string[]>
}

type Stage = 'meta' | 'thumb'

const STAGE_LABEL: Record<Stage, string> = {
  meta: 'Lecture des métadonnées',
  thumb: 'Création des miniatures'
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
  private progress = new Map<Stage, JobGroupState>()
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
      } while (this.indexAgain && !this.closed)
    })().finally(() => {
      this.indexing = null
    })
    return this.indexing
  }

  private pendingCount(stage: Stage): number {
    const sql = stage === 'meta'
      ? 'SELECT count(*) AS n FROM assets WHERE meta_state = 0 AND missing_at IS NULL'
      : 'SELECT count(*) AS n FROM assets WHERE thumb_state = 0 AND meta_state <> 0 AND hidden = 0 AND missing_at IS NULL'
    return (this.db.prepare(sql).get() as { n: number }).n
  }

  private async runStage(stage: Stage): Promise<void> {
    const concurrency = stage === 'meta' ? Math.max(4, cpus().length) : Math.max(2, Math.floor(cpus().length / 2))
    const run = limiter(concurrency)
    const select = stage === 'meta'
      ? this.db.prepare(`SELECT * FROM assets WHERE meta_state = 0 AND missing_at IS NULL
          ORDER BY day DESC, taken_at DESC LIMIT 256`)
      : this.db.prepare(`SELECT * FROM assets WHERE thumb_state = 0 AND meta_state <> 0 AND hidden = 0 AND missing_at IS NULL
          ORDER BY day DESC, taken_at DESC LIMIT 256`)
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
              const ok = stage === 'meta' ? await this.indexMeta(row) : await this.indexThumb(row)
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

  private markThumb(row: Row, ratio: number): void {
    const known = row.ratio as number | null
    this.db.prepare('UPDATE assets SET thumb_state = 1, ratio = ? WHERE id = ?').run(known ?? ratio, row.id as number)
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
      ? this.db.prepare(`SELECT id, path, live_video FROM assets WHERE trashed_at IS NOT NULL AND id IN (${ids.map(() => '?').join(',')})`).all(...ids)
      : this.db.prepare('SELECT id, path, live_video FROM assets WHERE trashed_at IS NOT NULL').all()) as Array<{ id: number; path: string; live_video: string | null }>
    if (!rows.length) return { removed: 0, failed: 0 }
    const paths = rows.flatMap((r) => (r.live_video ? [r.path, r.live_video] : [r.path]))
    const failed = new Set(await this.opts.moveToSystemTrash(paths))
    const done = rows.filter((r) => !failed.has(r.path))
    transaction(this.db, () => {
      const del = this.db.prepare('DELETE FROM assets WHERE id = ? OR (path = ? AND hidden = 1)')
      for (const r of done) del.run(r.id, r.live_video ?? '')
    })
    this.emitChanged()
    return { removed: done.length, failed: rows.length - done.length }
  }
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

