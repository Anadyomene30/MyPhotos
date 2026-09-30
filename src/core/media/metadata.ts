import { open, readFile } from 'node:fs/promises'
import exifr from 'exifr'
import { ffprobe, type FfprobeResult } from './ffmpeg'
import { HEIF_EXTS, RAW_EXTS, SHARP_EXTS, looksLikeScreenshot } from './kinds'
import type { AssetKind } from '@shared/types'

export interface MediaMetadata {
  takenAt: number
  tzOffset: number | null
  day: string
  dateSource: 'exif' | 'video' | 'filename' | 'folder' | 'mtime'
  width: number | null
  height: number | null
  orientation: number | null
  duration: number | null
  lat: number | null
  lon: number | null
  make: string | null
  model: string | null
  lens: string | null
  iso: number | null
  fnumber: number | null
  exposure: number | null
  focal: number | null
  screenshot: boolean
  contentId: string | null
}

interface WallClock {
  y: number
  mo: number
  d: number
  h: number
  mi: number
  s: number
  ms: number
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')
const dayOf = (w: WallClock): string => `${pad(w.y, 4)}-${pad(w.mo)}-${pad(w.d)}`

function validWall(w: WallClock): boolean {
  return w.y >= 1970 && w.y <= 2100 && w.mo >= 1 && w.mo <= 12 && w.d >= 1 && w.d <= 31 && w.h < 24 && w.mi < 60 && w.s < 61
}

/** "2023:08:12 15:30:12", "2023-08-12T15:30:12.123+02:00", ... */
export function parseDateString(value: string): { wall: WallClock; offset: number | null } | null {
  const m = /^(\d{4})[:\-](\d{2})[:\-](\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:[.,](\d+))?\s*(Z|[+\-]\d{2}:?\d{2})?/.exec(value.trim())
  if (!m) return null
  const wall: WallClock = {
    y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +m[6]!,
    ms: m[7] ? Math.round(+`0.${m[7]}` * 1000) : 0
  }
  if (!validWall(wall)) return null
  return { wall, offset: m[8] ? parseOffset(m[8]) : null }
}

export function parseOffset(value: string): number | null {
  if (value === 'Z') return 0
  const m = /^([+\-])(\d{2}):?(\d{2})$/.exec(value.trim())
  if (!m) return null
  return (m[1] === '-' ? -1 : 1) * (+m[2]! * 60 + +m[3]!)
}

/** Resolve a wall-clock reading into a UTC timestamp and the local calendar day where it was taken. */
function resolveWall(wall: WallClock, offset: number | null): { takenAt: number; day: string; tzOffset: number | null } {
  if (offset !== null) {
    const utc = Date.UTC(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s, wall.ms) - offset * 60000
    return { takenAt: utc, day: dayOf(wall), tzOffset: offset }
  }
  const local = new Date(wall.y, wall.mo - 1, wall.d, wall.h, wall.mi, wall.s, wall.ms).getTime()
  return { takenAt: local, day: dayOf(wall), tzOffset: null }
}

export function localDay(ms: number): string {
  const d = new Date(ms)
  return `${pad(d.getFullYear(), 4)}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const FILENAME_DATE = /(?:^|[^\d])((?:19|20)\d{2})[-_.]?(\d{2})[-_.]?(\d{2})(?:[ _\-T.]|[ _](?:à|at|um|a las|alle)[ _])?(\d{2})[-_.:h]?(\d{2})[-_.:m]?(\d{2})\d{0,3}(?:[^\d]|$)/
const FILENAME_DAY = /(?:^|[^\d])((?:19|20)\d{2})[-_.](\d{2})[-_.](\d{2})(?:[^\d]|$)/

/** IMG_20230812_153012.jpg, PXL_20230812_153012123.jpg, 2023-08-12 15.30.12.jpg, WhatsApp Image 2023-08-12 at ... */
export function dateFromFilename(name: string): WallClock | null {
  let m = FILENAME_DATE.exec(name)
  if (m) {
    const w = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: +m[4]!, mi: +m[5]!, s: +m[6]!, ms: 0 }
    if (validWall(w)) return w
  }
  m = FILENAME_DAY.exec(name)
  if (m) {
    const w = { y: +m[1]!, mo: +m[2]!, d: +m[3]!, h: 12, mi: 0, s: 0, ms: 0 }
    if (validWall(w)) return w
  }
  return null
}

/**
 * Date hinted by the folder path ("2019/2019-03", "2018-12-24 Noël", "Vacances 2017"), deepest segment first.
 * Returns the covered period so the file date can be kept when it falls inside it.
 */
export function periodFromPath(relDir: string): { start: number; end: number } | null {
  const segs = relDir.split(/[\\/]/).filter(Boolean).reverse()
  for (const seg of segs) {
    let m = /(?:^|[^\d])((?:19|20)\d{2})[-_.](\d{2})[-_.](\d{2})(?:[^\d]|$)/.exec(seg)
    if (m && +m[2]! >= 1 && +m[2]! <= 12 && +m[3]! >= 1 && +m[3]! <= 31) {
      const start = new Date(+m[1]!, +m[2]! - 1, +m[3]!).getTime()
      return { start, end: new Date(+m[1]!, +m[2]! - 1, +m[3]! + 1).getTime() }
    }
    m = /(?:^|[^\d])((?:19|20)\d{2})[-_.](\d{2})(?:[^\d]|$)/.exec(seg)
    if (m && +m[2]! >= 1 && +m[2]! <= 12) {
      return { start: new Date(+m[1]!, +m[2]! - 1, 1).getTime(), end: new Date(+m[1]!, +m[2]!, 1).getTime() }
    }
    m = /(?:^|[^\d])((?:19|20)\d{2})(?:[^\d]|$)/.exec(seg)
    if (m) return { start: new Date(+m[1]!, 0, 1).getTime(), end: new Date(+m[1]! + 1, 0, 1).getTime() }
  }
  return null
}

/** Best date without embedded metadata: file name, then folder period, then modification time. */
export function fallbackDate(name: string, relDir: string, mtime: number): { takenAt: number; day: string; source: 'filename' | 'folder' | 'mtime' } {
  const w = dateFromFilename(name)
  if (w) {
    const r = resolveWall(w, null)
    return { takenAt: r.takenAt, day: r.day, source: 'filename' }
  }
  const p = periodFromPath(relDir)
  if (p && (mtime < p.start || mtime >= p.end)) {
    const t = p.start + 12 * 3600000
    return { takenAt: t, day: localDay(t), source: 'folder' }
  }
  return { takenAt: mtime, day: localDay(mtime), source: 'mtime' }
}

function gpsToDecimal(v: unknown, ref: unknown): number | null {
  let n: number | null = null
  if (typeof v === 'number') n = v
  else if (Array.isArray(v) && v.length >= 1) n = (+v[0] || 0) + (+v[1] || 0) / 60 + (+v[2] || 0) / 3600
  if (n === null || !Number.isFinite(n)) return null
  if (typeof ref === 'string' && (ref === 'S' || ref === 'W')) n = -n
  return n
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() ? v.replace(/\0/g, '').trim() : null)
const num = (v: unknown): number | null => {
  const n = Array.isArray(v) ? Number(v[0]) : Number(v)
  return v === null || v === undefined || !Number.isFinite(n) ? null : n
}

function base(name: string, relDir: string, mtime: number): MediaMetadata {
  const f = fallbackDate(name, relDir, mtime)
  return {
    takenAt: f.takenAt,
    tzOffset: null,
    day: f.day,
    dateSource: f.source,
    width: null, height: null, orientation: null, duration: null,
    lat: null, lon: null, make: null, model: null, lens: null,
    iso: null, fnumber: null, exposure: null, focal: null,
    screenshot: false, contentId: null
  }
}

const EXIF_OPTIONS = {
  tiff: true, ifd0: {}, exif: true, gps: true, interop: false, ifd1: false,
  xmp: false, icc: false, iptc: false, jfif: false, ihdr: true,
  userComment: true, makerNote: false,
  reviveValues: false, translateValues: false, translateKeys: true, mergeOutput: true, sanitize: true
} as const

async function readHead(file: string, bytes: number): Promise<Buffer> {
  const fh = await open(file, 'r')
  try {
    const buf = Buffer.alloc(bytes)
    const { bytesRead } = await fh.read(buf, 0, bytes, 0)
    return buf.subarray(0, bytesRead)
  } finally {
    await fh.close()
  }
}

/**
 * exifr's own file reader breaks on recent Node versions, so feed it bytes.
 * The EXIF block sits in the first few hundred KiB for JPEG, HEIC and TIFF-based RAW; fall back to the whole file otherwise.
 */
async function parseExif(file: string, deep: boolean): Promise<Record<string, unknown> | undefined> {
  const attempt = async (buf: Buffer): Promise<Record<string, unknown> | undefined> => {
    try {
      return (await exifr.parse(buf, EXIF_OPTIONS as never)) as Record<string, unknown> | undefined
    } catch {
      return undefined
    }
  }
  const head = await readHead(file, 512 * 1024)
  const tags = await attempt(head)
  if (tags && (tags.DateTimeOriginal || tags.CreateDate || tags.Make)) return tags
  if (!deep || head.length < 512 * 1024) return tags
  const full = await readFile(file).catch(() => null)
  return full && full.length <= 300 * 1024 * 1024 ? ((await attempt(full)) ?? tags) : tags
}

export async function readImageMetadata(file: string, name: string, ext: string, mtime: number, relDir = ''): Promise<MediaMetadata> {
  const meta = base(name, relDir, mtime)
  let tags: Record<string, unknown> | undefined
  if (SHARP_EXTS.has(ext) || HEIF_EXTS.has(ext) || RAW_EXTS.has(ext)) tags = await parseExif(file, HEIF_EXTS.has(ext) || RAW_EXTS.has(ext))
  if (tags) {
    const dateStr = str(tags.DateTimeOriginal) ?? str(tags.CreateDate) ?? str(tags.DateTimeDigitized) ?? str(tags.ModifyDate)
    const parsed = dateStr ? parseDateString(dateStr) : null
    // sub-second precision orders burst and bracket frames shot within the same second
    const subsec = str(tags.SubSecTimeOriginal) ?? (typeof tags.SubSecTimeOriginal === 'number' ? String(tags.SubSecTimeOriginal) : null)
    if (parsed && subsec && /^\d+$/.test(subsec) && parsed.wall.ms === 0) parsed.wall.ms = Math.round(Number(`0.${subsec}`) * 1000)
    if (parsed) {
      const offset = parsed.offset ?? parseOffset(str(tags.OffsetTimeOriginal) ?? str(tags.OffsetTime) ?? '')
      const r = resolveWall(parsed.wall, offset)
      meta.takenAt = r.takenAt
      meta.day = r.day
      meta.tzOffset = r.tzOffset
      meta.dateSource = 'exif'
    }
    meta.orientation = num(tags.Orientation)
    meta.width = num(tags.ExifImageWidth) ?? num(tags.ImageWidth) ?? num(tags.PixelXDimension)
    meta.height = num(tags.ExifImageHeight) ?? num(tags.ImageHeight) ?? num(tags.PixelYDimension)
    meta.lat = gpsToDecimal(tags.GPSLatitude, tags.GPSLatitudeRef)
    meta.lon = gpsToDecimal(tags.GPSLongitude, tags.GPSLongitudeRef)
    if (meta.lat === 0 && meta.lon === 0) meta.lat = meta.lon = null
    meta.make = str(tags.Make)
    meta.model = str(tags.Model)
    meta.lens = str(tags.LensModel)
    meta.iso = num(tags.ISO) ?? num(tags.ISOSpeedRatings)
    meta.fnumber = num(tags.FNumber)
    meta.exposure = num(tags.ExposureTime)
    meta.focal = num(tags.FocalLength)
    const comment = typeof tags.UserComment === 'string' ? tags.UserComment : tags.UserComment instanceof Uint8Array ? Buffer.from(tags.UserComment).toString('latin1') : null
    meta.screenshot = looksLikeScreenshot(name, ext, Boolean(meta.make || meta.model), comment)
  } else {
    meta.screenshot = looksLikeScreenshot(name, ext, false)
  }
  return meta
}

export async function readVideoMetadata(file: string, name: string, mtime: number, relDir = ''): Promise<MediaMetadata> {
  const meta = base(name, relDir, mtime)
  let probe: FfprobeResult
  try {
    probe = await ffprobe(file)
  } catch {
    return meta
  }
  const v = probe.streams?.find((s) => s.codec_type === 'video')
  const tags = { ...(probe.format?.tags ?? {}), ...(v?.tags ?? {}) }
  const t = (k: string): string | null => tags[k] ?? tags[k.toLowerCase()] ?? null

  const appleDate = t('com.apple.quicktime.creationdate')
  const parsedApple = appleDate ? parseDateString(appleDate) : null
  const creation = t('creation_time')
  const parsedCreation = creation ? parseDateString(creation) : null
  if (parsedApple) {
    const r = resolveWall(parsedApple.wall, parsedApple.offset)
    Object.assign(meta, { takenAt: r.takenAt, day: r.day, tzOffset: r.tzOffset, dateSource: 'video' })
  } else if (parsedCreation && parsedCreation.wall.y > 1980) {
    // creation_time is UTC. Show it on the viewer's local calendar.
    const utc = resolveWall(parsedCreation.wall, parsedCreation.offset ?? 0).takenAt
    Object.assign(meta, { takenAt: utc, day: localDay(utc), tzOffset: null, dateSource: 'video' })
  }

  const duration = num(probe.format?.duration) ?? num(v?.duration)
  meta.duration = duration
  let w = v?.width ?? null
  let h = v?.height ?? null
  const rotation = v?.side_data_list?.find((s) => typeof s.rotation === 'number')?.rotation ?? num(v?.tags?.rotate) ?? 0
  if (w && h && Math.abs(rotation) % 180 === 90) [w, h] = [h, w]
  meta.width = w
  meta.height = h

  const iso6709 = t('com.apple.quicktime.location.ISO6709') ?? t('location')
  if (iso6709) {
    const m = /^([+\-]\d+(?:\.\d+)?)([+\-]\d+(?:\.\d+)?)/.exec(iso6709)
    if (m) {
      meta.lat = +m[1]!
      meta.lon = +m[2]!
    }
  }
  meta.make = t('com.apple.quicktime.make')
  meta.model = t('com.apple.quicktime.model')
  meta.contentId = t('com.apple.quicktime.content.identifier')
  meta.screenshot = /screen ?recording|enregistrement de l.écran|rpreplay/i.test(name)
  return meta
}

export async function readMetadata(file: string, name: string, ext: string, kind: AssetKind, mtime: number, relDir = ''): Promise<MediaMetadata> {
  return kind === 'video' ? readVideoMetadata(file, name, mtime, relDir) : readImageMetadata(file, name, ext, mtime, relDir)
}
