import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { copyFile, mkdir, rm, utimes } from 'node:fs/promises'
import { join } from 'node:path'
import type { Sharp } from 'sharp'
import { openImage } from '../media/decode'
import { ffmpegPaths } from '../media/ffmpeg'
import { extOf } from '../media/kinds'
import type { Row } from '../db'
import { baseName, NameAllocator, subFolder, wallParts } from './naming'
import { availableEncoders, planVideo } from './video'
import type { AssetKind, ExportOptions, ExportResult } from '@shared/types'

const PHOTO_EXT = { jpeg: 'jpg', png: 'png', webp: 'webp', avif: 'avif', tiff: 'tif' } as const

export interface ExportProgress {
  (doneUnits: number, totalUnits: number): void
}

const pad = (n: number): string => String(n).padStart(2, '0')

function exifDate(takenAt: number, tzOffset: number | null): string {
  const w = wallParts(takenAt, tzOffset)
  return `${w.y}:${pad(w.mo)}:${pad(w.d)} ${pad(w.h)}:${pad(w.mi)}:${pad(w.s)}`
}

function dms(v: number): string {
  const a = Math.abs(v)
  const d = Math.floor(a)
  const m = Math.floor((a - d) * 60)
  const s = ((a - d) * 60 - m) * 60
  return `${d}/1 ${m}/1 ${Math.round(s * 100)}/100`
}

/** Rebuild essential EXIF from the database: works for every source (HEIC, RAW previews lose their EXIF when decoded). */
function withMetadata(img: Sharp, row: Row, mode: ExportOptions['metadata']): Sharp {
  if (mode === 'none') return img
  const takenAt = row.taken_at as number
  const tz = row.tz_offset as number | null
  const ifd0: Record<string, string> = { Software: 'MyPhotos' }
  if (row.make) ifd0.Make = String(row.make)
  if (row.model) ifd0.Model = String(row.model)
  const ifd2: Record<string, string> = { DateTimeOriginal: exifDate(takenAt, tz), DateTimeDigitized: exifDate(takenAt, tz) }
  if (tz !== null) ifd2.OffsetTimeOriginal = `${tz >= 0 ? '+' : '-'}${pad(Math.floor(Math.abs(tz) / 60))}:${pad(Math.abs(tz) % 60)}`
  if (row.lens) ifd2.LensModel = String(row.lens)
  const exif: Record<string, Record<string, string>> = { IFD0: ifd0, IFD2: ifd2 }
  if (mode === 'all' && typeof row.lat === 'number' && typeof row.lon === 'number') {
    exif.IFD3 = {
      GPSLatitudeRef: row.lat >= 0 ? 'N' : 'S', GPSLatitude: dms(row.lat),
      GPSLongitudeRef: row.lon >= 0 ? 'E' : 'W', GPSLongitude: dms(row.lon)
    }
  }
  return img.withExif(exif).keepIccProfile()
}

async function exportPhoto(row: Row, out: string, opts: ExportOptions): Promise<void> {
  const f = opts.photo.format
  let img = await openImage({ path: row.path as string, ext: row.ext as string, kind: 'photo', orientation: row.orientation as number | null, duration: null })
  if (opts.photo.maxSize) img = img.resize({ width: opts.photo.maxSize, height: opts.photo.maxSize, fit: 'inside', withoutEnlargement: true })
  const q = Math.max(1, Math.min(100, Math.round(opts.photo.quality)))
  if (f === 'jpeg') img = img.jpeg({ quality: q, mozjpeg: true, chromaSubsampling: q >= 90 ? '4:4:4' : '4:2:0' })
  else if (f === 'png') img = img.png({ compressionLevel: 8 })
  else if (f === 'webp') img = img.webp({ quality: q, effort: 4 })
  else if (f === 'avif') img = img.avif({ quality: Math.round(q * 0.75), effort: 4 })
  else if (f === 'tiff') img = img.tiff({ compression: 'lzw' })
  img = withMetadata(img, row, opts.metadata)
  await img.toFile(out)
}

function runFfmpeg(args: string[], durationSec: number | null, onFraction: (f: number) => void, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    const child = spawn(ffmpegPaths().ffmpeg, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let err = ''
    const abort = (): void => {
      child.kill('SIGKILL')
    }
    signal.addEventListener('abort', abort, { once: true })
    child.stdout.on('data', (d: Buffer) => {
      const m = /out_time_us=(\d+)/.exec(d.toString())
      if (m && durationSec) onFraction(Math.min(1, Number(m[1]) / 1e6 / durationSec))
    })
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 4000) err += d.toString()
    })
    child.on('error', reject)
    child.on('close', (code) => {
      signal.removeEventListener('abort', abort)
      if (signal.aborted) reject(new Error('cancelled'))
      else if (code === 0) resolve()
      else reject(new Error(err.trim().split('\n').slice(-2).join(' ') || `ffmpeg exited with ${code}`))
    })
  })
}

async function exportVideo(row: Row, out: string, opts: ExportOptions, onFraction: (f: number) => void, signal: AbortSignal): Promise<void> {
  const encoders = await availableEncoders()
  const creation = new Date(row.taken_at as number).toISOString()
  const plan = planVideo(row.path as string, out, opts, encoders, row.height as number | null, creation)
  const duration = row.duration as number | null
  try {
    await runFfmpeg(plan.args, duration, onFraction, signal)
  } catch (e) {
    if (signal.aborted || !plan.fallback) throw e
    await runFfmpeg(plan.fallback, duration, onFraction, signal)
  }
}

export interface ExportRunner {
  result: Promise<ExportResult>
  cancel(): void
}

/**
 * Export assets into a destination folder. Originals are only read; outputs never overwrite existing files.
 * Progress units: 1 per photo, 10 per video (weighted by encoding time).
 */
export function runExport(jobId: string, rows: Row[], opts: ExportOptions, onProgress: ExportProgress): ExportRunner {
  const ctrl = new AbortController()
  const alloc = new NameAllocator((p) => existsSync(p))
  const units = (r: Row): number => ((r.kind as AssetKind) === 'video' && opts.video.format !== 'original' ? 10 : 1)
  const total = rows.reduce((a, r) => a + units(r), 0)

  const result = (async (): Promise<ExportResult> => {
    let done = 0
    let exported = 0
    let failed = 0
    const errors: string[] = []
    await mkdir(opts.destination, { recursive: true })
    for (let i = 0; i < rows.length; i++) {
      if (ctrl.signal.aborted) break
      const row = rows[i]!
      const kind = row.kind as AssetKind
      const dir = join(opts.destination, ...subFolder(opts.folders, row.taken_at as number, row.tz_offset as number | null))
      const base = baseName(opts, {
        stem: String(row.name).replace(/\.[^.]+$/, ''),
        takenAt: row.taken_at as number,
        tzOffset: row.tz_offset as number | null,
        make: row.make as string | null,
        model: row.model as string | null,
        index: i + 1
      })
      const w = units(row)
      let out = ''
      try {
        await mkdir(dir, { recursive: true })
        if (kind === 'photo') {
          if (opts.photo.format === 'original') {
            out = alloc.allocate(dir, base, extOf(String(row.name)) || 'jpg', join)
            await copyFile(row.path as string, out)
          } else {
            out = alloc.allocate(dir, base, PHOTO_EXT[opts.photo.format], join)
            await exportPhoto(row, out, opts)
          }
          if (opts.includeRaw && row.raw_companion) {
            const rp = String(row.raw_companion)
            await copyFile(rp, alloc.allocate(dir, base, extOf(rp) || 'raw', join))
          }
          if (opts.includeLiveVideo && row.live_video) {
            const lv = String(row.live_video)
            const liveOut = alloc.allocate(dir, base, extOf(lv) || 'mov', join)
            await copyFile(lv, liveOut)
          }
        } else if (opts.video.format === 'original') {
          out = alloc.allocate(dir, base, extOf(String(row.name)) || 'mp4', join)
          await copyFile(row.path as string, out)
        } else {
          const ext = opts.video.format === 'gif' ? 'gif' : opts.video.format === 'webm' ? 'webm' : opts.video.format === 'mov-prores' ? 'mov' : 'mp4'
          out = alloc.allocate(dir, base, ext, join)
          const start = done
          await exportVideo(row, out, opts, (f) => onProgress(start + f * w, total), ctrl.signal)
        }
        if (opts.setFileDates) {
          const t = (row.taken_at as number) / 1000
          await utimes(out, t, t).catch(() => undefined)
        }
        exported++
      } catch (e) {
        if (out) await rm(out, { force: true }).catch(() => undefined)
        if (ctrl.signal.aborted) break
        failed++
        if (errors.length < 20) errors.push(`${row.name}: ${(e as Error).message}`)
      }
      done += w
      onProgress(done, total)
    }
    return { jobId, exported, failed, skipped: rows.length - exported - failed, destination: opts.destination, cancelled: ctrl.signal.aborted, errors }
  })()

  return { result, cancel: () => ctrl.abort() }
}
