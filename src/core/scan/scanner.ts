import { open, stat } from 'node:fs/promises'
import { basename, dirname, relative, sep } from 'node:path'
import { fdir } from 'fdir'
import { transaction, type Db } from '../db'
import { extOf, kindOf, RAW_EXTS, stemOf, looksLikeScreenshot } from '../media/kinds'
import { fallbackDate } from '../media/metadata'
import { limiter } from '../util'
import { bookmarkTargetPath } from './bookmark'

const IGNORED_DIRS = new Set(['@eaDir', '$RECYCLE.BIN', 'System Volume Information', '.thumbnails', 'node_modules', '#recycle', '.Trashes', '.Spotlight-V100', '.fseventsd'])

export function isIgnoredDir(name: string): boolean {
  return name.startsWith('.') || IGNORED_DIRS.has(name) || name.endsWith('.photoslibrary') || name.endsWith('.photolibrary') || name.endsWith('.app')
}

export function isCandidateFile(path: string): boolean {
  const name = basename(path)
  if (name.startsWith('.') || name.startsWith('~')) return false
  return kindOf(extOf(name)) !== null
}

/** Finder aliases (bookmark data) and Windows .lnk shortcuts can carry a photo extension; they are not photos. */
export function isShortcutHeader(head: Uint8Array): boolean {
  const ascii = (from: number, to: number): string => String.fromCharCode(...head.subarray(from, to))
  if (head.length >= 12 && ascii(0, 4) === 'book' && ascii(8, 12) === 'mark') return true
  return head.length >= 8 && head[0] === 0x4c && head[1] === 0 && head[2] === 0 && head[3] === 0 && head[4] === 0x01 && head[5] === 0x14 && head[6] === 0x02 && head[7] === 0x00
}

const SHORTCUT_MAX_SIZE = 64 * 1024

export interface Shortcut {
  path: string
  /** absolute path the alias points to, when it can be read (macOS bookmarks) */
  target: string | null
}

/** Only small files can be shortcuts, so real photos and videos are never opened here. */
export async function readShortcut(path: string, size: number): Promise<Shortcut | null> {
  if (size >= SHORTCUT_MAX_SIZE) return null
  const fh = await open(path, 'r')
  try {
    const head = new Uint8Array(16)
    const { bytesRead } = await fh.read(head, 0, 16, 0)
    if (!isShortcutHeader(head.subarray(0, bytesRead))) return null
    const all = new Uint8Array(size)
    await fh.read(all, 0, size, 0)
    return { path, target: bookmarkTargetPath(all) }
  } finally {
    await fh.close()
  }
}

export async function listMediaFiles(root: string): Promise<string[]> {
  return new fdir()
    .withFullPaths()
    .withErrors()
    .exclude((dirName) => isIgnoredDir(dirName))
    .filter((path, isDirectory) => !isDirectory && isCandidateFile(path))
    .crawl(root)
    .withPromise()
    .catch(() => [] as string[])
}

export interface ScanResult {
  added: number
  changed: number
  missing: number
  total: number
  shortcuts: Shortcut[]
}

interface ExistingRow {
  id: number
  path: string
  size: number
  mtime: number
  missing_at: number | null
}

export function initialDate(name: string, relDir: string, mtime: number): { takenAt: number; day: string; source: string } {
  const f = fallbackDate(name, relDir, mtime)
  return { takenAt: f.takenAt, day: f.day, source: f.source }
}

/** Walk a source folder and reconcile the assets table with what is on disk. Never touches the files. */
export async function scanSource(db: Db, sourceId: number, root: string, onProgress?: (n: number) => void): Promise<ScanResult> {
  const files = await listMediaFiles(root)
  const existing = new Map<string, ExistingRow>()
  for (const r of db.prepare('SELECT id, path, size, mtime, missing_at FROM assets WHERE source_id = ?').all(sourceId) as unknown as ExistingRow[]) {
    existing.set(r.path, r)
  }

  const statLimit = limiter(64)
  const seen = new Set<string>()
  const toInsert: Array<{ path: string; size: number; mtime: number }> = []
  const toUpdate: Array<{ id: number; size: number; mtime: number }> = []
  const reappeared: number[] = []
  const shortcuts: Shortcut[] = []
  let n = 0

  await Promise.all(
    files.map((path) =>
      statLimit(async () => {
        try {
          const st = await stat(path)
          if (!st.isFile() || st.size === 0) return
          const sc = await readShortcut(path, st.size)
          if (sc) {
            shortcuts.push(sc)
            return
          }
          seen.add(path)
          const mtime = Math.round(st.mtimeMs)
          const prev = existing.get(path)
          if (!prev) toInsert.push({ path, size: st.size, mtime })
          else {
            if (prev.size !== st.size || prev.mtime !== mtime) toUpdate.push({ id: prev.id, size: st.size, mtime })
            if (prev.missing_at !== null) reappeared.push(prev.id)
          }
        } catch {
          /* unreadable file: ignore */
        }
        if (++n % 500 === 0) onProgress?.(n)
      })
    )
  )

  const now = Date.now()
  const missing = [...existing.values()].filter((r) => !seen.has(r.path) && r.missing_at === null)

  transaction(db, () => {
    const ins = db.prepare(`INSERT INTO assets
      (source_id, path, rel_dir, name, stem, ext, kind, size, mtime, taken_at, day, date_source, is_raw, is_screenshot, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    for (const f of toInsert) {
      const name = basename(f.path)
      const ext = extOf(name)
      const kind = kindOf(ext)!
      const rel = relative(root, dirname(f.path)).split(sep).join('/')
      const d = initialDate(name, rel, f.mtime)
      ins.run(sourceId, f.path, rel, name, stemOf(name), ext, kind, f.size, f.mtime, d.takenAt, d.day, d.source,
        RAW_EXTS.has(ext) ? 1 : 0, looksLikeScreenshot(name, ext, false) ? 1 : 0, now)
    }
    const upd = db.prepare('UPDATE assets SET size = ?, mtime = ?, meta_state = 0, thumb_state = 0, thumb_v = thumb_v + 1 WHERE id = ?')
    for (const f of toUpdate) upd.run(f.size, f.mtime, f.id)
    const back = db.prepare('UPDATE assets SET missing_at = NULL WHERE id = ?')
    for (const id of reappeared) back.run(id)
    const gone = db.prepare('UPDATE assets SET missing_at = ? WHERE id = ?')
    for (const r of missing) gone.run(now, r.id)
    pairLivePhotos(db, sourceId)
  })

  return { added: toInsert.length, changed: toUpdate.length, missing: missing.length, total: seen.size, shortcuts }
}

/**
 * Pair photo + short video sharing the same folder and file stem (IMG_1234.HEIC + IMG_1234.MOV).
 * The video becomes hidden and is played from the photo. Videos longer than 6 s are never treated as Live Photos.
 */
export function pairLivePhotos(db: Db, sourceId?: number): void {
  pairRawJpeg(db, sourceId)
  linkVersions(db)
  const scope = sourceId === undefined ? '' : 'AND v.source_id = ?'
  const args = sourceId === undefined ? [] : [sourceId]
  db.prepare(`UPDATE assets SET hidden = 1 WHERE id IN (
      SELECT v.id FROM assets v JOIN assets p
        ON p.source_id = v.source_id AND p.rel_dir = v.rel_dir AND p.stem = v.stem AND p.kind = 'photo' AND p.missing_at IS NULL
      WHERE v.kind = 'video' AND v.ext IN ('mov', 'mp4') AND v.hidden = 0 AND (v.duration IS NULL OR v.duration <= 6) ${scope})`).run(...args)
  db.prepare(`UPDATE assets SET hidden = 0 WHERE kind = 'video' AND hidden = 1 AND duration > 6 ${sourceId === undefined ? '' : 'AND source_id = ?'}`).run(...args)
  db.prepare(`UPDATE assets SET is_live = 0, live_video = NULL WHERE is_live = 1 ${sourceId === undefined ? '' : 'AND source_id = ?'}`).run(...args)
  db.prepare(`UPDATE assets AS p SET is_live = 1, live_video = v.path
      FROM assets v
      WHERE v.source_id = p.source_id AND v.rel_dir = p.rel_dir AND v.stem = p.stem AND v.kind = 'video' AND v.hidden = 1 AND v.missing_at IS NULL
        AND p.kind = 'photo' ${sourceId === undefined ? '' : 'AND p.source_id = ?'}`).run(...args)
}

/** Apply a batch of filesystem change notifications incrementally, without a full rescan. */
export async function applyChanges(db: Db, sourceId: number, root: string, paths: string[], onShortcut?: (s: Shortcut) => void): Promise<number> {
  const files = new Map<string, { size: number; mtime: number } | null>()
  const goneDirs: string[] = []
  for (const p of paths) {
    try {
      const st = await stat(p)
      if (st.isDirectory()) {
        if (isIgnoredDir(basename(p))) continue
        for (const f of await listMediaFiles(p)) {
          try {
            const fst = await stat(f)
            if (fst.size === 0) continue
            const sc = await readShortcut(f, fst.size)
            if (sc) {
              onShortcut?.(sc)
              continue
            }
            files.set(f, { size: fst.size, mtime: Math.round(fst.mtimeMs) })
          } catch {
            /* ignore */
          }
        }
      } else if (st.isFile() && isCandidateFile(p) && st.size > 0) {
        const sc = await readShortcut(p, st.size)
        if (sc) onShortcut?.(sc)
        files.set(p, sc ? null : { size: st.size, mtime: Math.round(st.mtimeMs) })
      }
    } catch {
      if (isCandidateFile(p)) files.set(p, null)
      else goneDirs.push(p)
    }
  }
  if (files.size === 0 && goneDirs.length === 0) return 0
  const now = Date.now()
  let changes = 0
  transaction(db, () => {
    const get = db.prepare('SELECT id, size, mtime, missing_at FROM assets WHERE path = ?')
    const ins = db.prepare(`INSERT INTO assets
      (source_id, path, rel_dir, name, stem, ext, kind, size, mtime, taken_at, day, date_source, is_raw, is_screenshot, added_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
    const upd = db.prepare('UPDATE assets SET size = ?, mtime = ?, missing_at = NULL, meta_state = 0, thumb_state = 0, thumb_v = thumb_v + 1 WHERE id = ?')
    const back = db.prepare('UPDATE assets SET missing_at = NULL WHERE id = ?')
    const gone = db.prepare('UPDATE assets SET missing_at = ? WHERE id = ? AND missing_at IS NULL')
    for (const [path, st] of files) {
      const prev = get.get(path) as unknown as ExistingRow | undefined
      if (!st) {
        if (prev) changes += Number(gone.run(now, prev.id).changes)
        continue
      }
      if (!prev) {
        const name = basename(path)
        const ext = extOf(name)
        const rel = relative(root, dirname(path)).split(sep).join('/')
        const d = initialDate(name, rel, st.mtime)
        ins.run(sourceId, path, rel, name, stemOf(name), ext, kindOf(ext)!, st.size, st.mtime, d.takenAt, d.day, d.source,
          RAW_EXTS.has(ext) ? 1 : 0, looksLikeScreenshot(name, ext, false) ? 1 : 0, now)
        changes++
      } else if (prev.size !== st.size || prev.mtime !== st.mtime) {
        upd.run(st.size, st.mtime, prev.id)
        changes++
      } else if (prev.missing_at !== null) {
        back.run(prev.id)
        changes++
      }
    }
    const goneUnder = db.prepare("UPDATE assets SET missing_at = ? WHERE source_id = ? AND missing_at IS NULL AND (path LIKE ? ESCAPE '\\')")
    for (const dir of goneDirs) {
      const prefix = (dir.endsWith(sep) ? dir : dir + sep).replace(/[\\%_]/g, (c) => '\\' + c)
      changes += Number(goneUnder.run(now, sourceId, prefix + '%').changes)
    }
    if (changes) pairLivePhotos(db, sourceId)
  })
  return changes
}

const RAW_SQL = "('cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', '3fr', 'iiq', 'erf', 'kdc', 'mrw', 'x3f')"
const JPEG_SQL = "('jpg', 'jpeg', 'jpe', 'heic', 'heif')"

/**
 * Cameras shooting RAW + JPEG write IMG_1234.CR2 next to IMG_1234.JPG. Show the JPEG, keep the RAW attached
 * (exported, trashed and restored with it) instead of listing the same photo twice.
 */
export function pairRawJpeg(db: Db, sourceId?: number): void {
  const scope = sourceId === undefined ? '' : 'AND r.source_id = ?'
  const args = sourceId === undefined ? [] : [sourceId]
  db.prepare(`UPDATE assets SET hidden = 1 WHERE id IN (
      SELECT r.id FROM assets r JOIN assets j
        ON j.source_id = r.source_id AND j.rel_dir = r.rel_dir AND j.stem = r.stem AND j.ext IN ${JPEG_SQL} AND j.missing_at IS NULL
      WHERE r.ext IN ${RAW_SQL} AND r.hidden = 0 AND r.missing_at IS NULL ${scope})`).run(...args)
  db.prepare(`UPDATE assets SET raw_companion = NULL, is_raw = 0 WHERE raw_companion IS NOT NULL ${sourceId === undefined ? '' : 'AND source_id = ?'}`).run(...args)
  // is_raw on the JPEG means "this photo also has a RAW file" (filters and badges)
  db.prepare(`UPDATE assets AS j SET raw_companion = r.path, is_raw = 1
      FROM assets r
      WHERE r.source_id = j.source_id AND r.rel_dir = j.rel_dir AND r.stem = j.stem AND r.ext IN ${RAW_SQL} AND r.hidden = 1 AND r.missing_at IS NULL
        AND j.ext IN ${JPEG_SQL} ${sourceId === undefined ? '' : 'AND j.source_id = ?'}`).run(...args)
  // a RAW whose JPEG disappeared becomes visible again
  db.prepare(`UPDATE assets SET hidden = 0 WHERE ext IN ${RAW_SQL} AND hidden = 1 AND NOT EXISTS (
      SELECT 1 FROM assets j WHERE j.source_id = assets.source_id AND j.rel_dir = assets.rel_dir AND j.stem = assets.stem AND j.ext IN ${JPEG_SQL} AND j.missing_at IS NULL)
      ${sourceId === undefined ? '' : 'AND source_id = ?'}`).run(...args)
}

/** Edited copies saved by MyPhotos are stacked under their original (hidden from the grid, shown as versions). */
export function linkVersions(db: Db): void {
  db.prepare(`UPDATE assets SET hidden = 1, version_of = (
      SELECT o.id FROM creations c JOIN assets o ON o.id = json_extract(c.sources, '$[0]')
      WHERE c.path = assets.path AND c.kind = 'edit-copy' AND o.missing_at IS NULL)
    WHERE path IN (SELECT path FROM creations WHERE kind = 'edit-copy') AND version_of IS NULL`).run()
  // the original disappeared: the copy becomes a regular item
  db.prepare(`UPDATE assets SET hidden = 0, version_of = NULL WHERE version_of IS NOT NULL
    AND NOT EXISTS (SELECT 1 FROM assets o WHERE o.id = assets.version_of AND o.missing_at IS NULL)`).run()
}
