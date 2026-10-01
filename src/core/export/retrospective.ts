import { mkdir, rm } from 'node:fs/promises'
import { cpus, tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp, { type Sharp } from 'sharp'
import type { Db, Row } from '../db'
import { openImage } from '../media/decode'
import { limiter } from '../util'
import { runFfmpeg } from './exporter'
import { availableEncoders } from './video'
import { renderPhoto, parseEdit } from '../edit/render'
import { select } from '../organize/memories'
import { fromBlob } from '../ml/vectors'
import type { RetroOptions } from '@shared/types'
import { t } from '@shared/i18n'

/**
 * Retrospective video: a paced slideshow of the best photos (and short video excerpts) of a period,
 * with smooth pans towards each photo's focal point, blurred fills for photos that do not match the
 * frame, title cards when the year changes, crossfades and a music track.
 */

export interface RetroItem {
  id: number
  kind: 'photo' | 'video'
  takenAt: number
  day: string
  ratio: number
  fx: number
  fy: number
  duration: number | null
}

export interface RetroSegment {
  type: 'photo' | 'video' | 'title'
  item?: RetroItem
  text?: string
  sub?: string
  seconds: number
}

export function frameSize(format: RetroOptions['format'], resolution: number): { w: number; h: number } {
  const even = (n: number): number => Math.round(n / 2) * 2
  if (format === '9:16') return { w: even((resolution * 9) / 16), h: resolution }
  if (format === '1:1') return { w: resolution, h: resolution }
  return { w: even((resolution * 16) / 9), h: resolution }
}

/** Pick items for the source, spread over time, and build the timed sequence of segments. */
export function planSequence(db: Db, opts: RetroOptions): RetroSegment[] {
  const per = opts.pace === 'fast' ? 2.2 : 3.6
  const cond: string[] = ['a.hidden = 0', 'a.missing_at IS NULL', 'a.trashed_at IS NULL']
  const params: Array<string | number> = []
  const src = opts.source
  if (src.type === 'year') {
    cond.push('a.day >= ? AND a.day <= ?')
    params.push(`${src.value}-01-01`, `${src.value}-12-31`)
  } else if (src.type === 'album') {
    cond.push('a.id IN (SELECT asset_id FROM album_assets WHERE album_id = ?)')
    params.push(src.value)
  } else if (src.type === 'person') {
    cond.push('a.id IN (SELECT asset_id FROM faces WHERE person_id = ?)')
    params.push(src.value)
  } else if (src.type === 'ids') {
    cond.push('a.id IN (SELECT value FROM json_each(?))')
    params.push(JSON.stringify(src.value))
  }
  if (!opts.includeVideos) cond.push("a.kind = 'photo'")
  const rows = db
    .prepare(`SELECT a.id, a.kind, a.taken_at, a.day, a.ratio, a.focal_x, a.focal_y, a.duration, a.quality, a.favorite, a.phash, a.is_screenshot, a.make, a.model,
        (SELECT count(*) FROM faces f WHERE f.asset_id = a.id AND f.person_id IS NOT NULL) AS faces,
        (SELECT emb FROM clip_emb c WHERE c.asset_id = a.id) AS clip,
        EXISTS (SELECT 1 FROM categories c WHERE c.asset_id = a.id AND c.label IN ('document', 'screenshot')) AS doc
      FROM assets a WHERE ${cond.join(' AND ')} ORDER BY a.taken_at`)
    .all(...params) as Row[]
  // images without any camera information are usually screenshots, memes or downloads
  const usable = rows.filter((r) => !r.is_screenshot && !r.doc && !(r.kind === 'photo' && !r.make && !r.model && !r.faces) && (r.kind === 'photo' || ((r.duration as number | null) ?? 0) >= 2))
  const byId = new Map(usable.map((r) => [r.id as number, r]))
  const target = Math.max(4, Math.round((opts.seconds - 3) / per))
  const cands = usable.map((r) => ({
    id: r.id as number, takenAt: r.taken_at as number, day: r.day as string, kind: r.kind as string,
    quality: ((r.quality as number | null) ?? 0.4) + (r.kind === 'video' ? -0.05 : 0), favorite: r.favorite === 1, faces: r.faces as number,
    screenshot: false, phash: r.phash as string | null, clip: r.clip ? fromBlob(r.clip as Uint8Array) : null, ratio: (r.ratio as number | null) ?? 1.5
  }))
  // spread over years proportionally, then pick the best diverse set within each year
  const years = new Map<string, typeof cands>()
  for (const c of cands) {
    const y = c.day.slice(0, 4)
    years.set(y, [...(years.get(y) ?? []), c])
  }
  const chosen: typeof cands = []
  const totalN = cands.length || 1
  for (const [, list] of [...years.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
    const quota = Math.max(1, Math.round((list.length / totalN) * target))
    chosen.push(...select(list, Math.min(quota, list.length), { timeSpreadMs: 45 * 60000 }))
  }
  // top up to the target with the best remaining items (small years round down)
  if (chosen.length < target) {
    const taken = new Set(chosen.map((c) => c.id))
    const rest = cands.filter((c) => !taken.has(c.id))
    chosen.push(...select(rest, Math.min(rest.length, target - chosen.length), { timeSpreadMs: 5 * 60000 }))
  }
  chosen.sort((a, b) => a.takenAt - b.takenAt)
  // cap videos to ~1 in 6 segments
  let videosLeft = Math.max(1, Math.floor(chosen.length / 6))
  const segs: RetroSegment[] = []
  const multiYear = new Set(chosen.map((c) => c.day.slice(0, 4))).size > 1
  let lastYear = ''
  if (opts.title) segs.push({ type: 'title', text: opts.title, sub: opts.subtitle ?? undefined, seconds: 3.2 })
  for (const c of chosen) {
    const r = byId.get(c.id)!
    const y = c.day.slice(0, 4)
    if (opts.titleCards && multiYear && y !== lastYear) {
      segs.push({ type: 'title', text: y, seconds: 2.4 })
      lastYear = y
    }
    const item: RetroItem = { id: c.id, kind: c.kind as 'photo' | 'video', takenAt: c.takenAt, day: c.day, ratio: c.ratio, fx: (r.focal_x as number | null) ?? 0.5, fy: (r.focal_y as number | null) ?? 0.5, duration: r.duration as number | null }
    if (item.kind === 'video') {
      if (videosLeft <= 0) continue
      videosLeft--
      segs.push({ type: 'video', item, seconds: Math.min(4, Math.max(2, (item.duration ?? 3) - 0.5)) })
    } else segs.push({ type: 'photo', item, seconds: per })
  }
  return segs
}

async function stillFor(db: Db, item: RetroItem, w: number, h: number, out: string, oversize: number): Promise<void> {
  const row = db.prepare('SELECT path, ext, kind, orientation, duration, edit FROM assets WHERE id = ?').get(item.id) as Row
  const input = { path: row.path as string, ext: row.ext as string, kind: 'photo' as const, orientation: row.orientation as number | null, duration: null }
  const edit = parseEdit(row.edit)
  const W = Math.round(w * oversize)
  const H = Math.round(h * oversize)
  let base: Sharp
  if (edit) {
    const r = await renderPhoto(input, edit, Math.max(W, H) * 1.2)
    base = sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
  } else base = await openImage(input)
  const buf = await base.resize({ width: Math.max(W, H) * 2, height: Math.max(W, H) * 2, fit: 'inside', withoutEnlargement: true }).removeAlpha().jpeg({ quality: 92 }).toBuffer()
  const meta = await sharp(buf).metadata()
  const ratio = (meta.width ?? 1) / (meta.height ?? 1)
  const frameRatio = W / H
  if (Math.abs(Math.log(ratio / frameRatio)) < 0.42) {
    // fill the frame, cropping around the focal point
    const scale = Math.max(W / meta.width!, H / meta.height!)
    const sw = Math.round(meta.width! * scale)
    const sh = Math.round(meta.height! * scale)
    const left = Math.max(0, Math.min(sw - W, Math.round(item.fx * sw - W / 2)))
    const top = Math.max(0, Math.min(sh - H, Math.round(item.fy * sh - H / 2)))
    await sharp(buf).resize(sw, sh).extract({ left, top, width: W, height: H }).jpeg({ quality: 90 }).toFile(out)
  } else {
    // whole photo over a blurred, darkened copy of itself
    const bg = await sharp(buf).resize(W, H, { fit: 'cover' }).blur(40).modulate({ brightness: 0.55, saturation: 1.1 }).toBuffer()
    const fg = await sharp(buf).resize(Math.round(W * 0.94), Math.round(H * 0.94), { fit: 'inside' }).toBuffer({ resolveWithObject: true })
    await sharp(bg)
      .composite([{ input: fg.data, left: Math.round((W - fg.info.width) / 2), top: Math.round((H - fg.info.height) / 2) }])
      .jpeg({ quality: 90 })
      .toFile(out)
  }
}

async function titleCard(text: string, sub: string | undefined, w: number, h: number, out: string, bgFile: string | null): Promise<void> {
  const esc = (s: string): string => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  const size = Math.round(Math.min(w, h) * (text.length <= 4 ? 0.22 : 0.085))
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <text x="50%" y="${sub ? '47%' : '52%'}" text-anchor="middle" dominant-baseline="middle" font-family="Helvetica Neue, Segoe UI, Arial, sans-serif" font-weight="700" font-size="${size}" fill="#fff" letter-spacing="${text.length <= 4 ? 8 : 1}">${esc(text)}</text>
    ${sub ? `<text x="50%" y="60%" text-anchor="middle" font-family="Helvetica Neue, Segoe UI, Arial, sans-serif" font-size="${Math.round(size * 0.32)}" fill="#ffffffcc">${esc(sub)}</text>` : ''}
  </svg>`
  const bg = bgFile
    ? await sharp(bgFile).resize(w, h, { fit: 'cover' }).blur(30).modulate({ brightness: 0.45 }).toBuffer()
    : await sharp({ create: { width: w, height: h, channels: 3, background: '#111' } }).png().toBuffer()
  await sharp(bg).composite([{ input: Buffer.from(svg) }]).jpeg({ quality: 92 }).toFile(out)
}

export interface RetroProgress {
  (fraction: number, label: string): void
}

/** Render the whole retrospective into `output`. */
export async function renderRetrospective(db: Db, opts: RetroOptions, output: string, onProgress: RetroProgress, signal: AbortSignal): Promise<{ seconds: number; segments: number }> {
  const segs = planSequence(db, opts)
  if (segs.filter((s) => s.type !== 'title').length < 3) throw new Error(t('Pas assez de photos pour cette vidéo'))
  const preview = opts.preview === true
  const { w, h } = frameSize(opts.format, preview ? 360 : opts.resolution)
  const fps = preview ? 15 : 30
  const tmp = join(tmpdir(), `myphotos-retro-${process.pid}-${Date.now()}`)
  await mkdir(tmp, { recursive: true })
  const encoders = await availableEncoders()
  const T = preview ? 0.4 : 0.7 // crossfade seconds
  const clipEnc = ['-c:v', 'libx264', '-preset', preview ? 'ultrafast' : 'veryfast', '-crf', preview ? '28' : '17', '-pix_fmt', 'yuv420p', '-r', String(fps)]
  try {
    // 1. stills and clips, in parallel
    const run = limiter(Math.max(2, Math.floor(cpus().length / 2)))
    let done = 0
    const clips: string[] = new Array(segs.length)
    const firstStillOfYear = new Map<number, string>()
    await Promise.all(
      segs.map((s, i) =>
        run(async () => {
          if (signal.aborted) throw new Error('cancelled')
          const clip = join(tmp, `c${String(i).padStart(4, '0')}.mp4`)
          const d = s.seconds + T
          if (s.type === 'video') {
            const row = db.prepare('SELECT path FROM assets WHERE id = ?').get(s.item!.id) as { path: string }
            const start = Math.max(0, ((s.item!.duration ?? d) - d) / 2)
            await runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-ss', start.toFixed(2), '-t', d.toFixed(2), '-i', row.path, '-an',
              '-vf', `scale=${w}:${h}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${w}:${h}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1,fps=${fps}`, ...clipEnc, clip], null, () => undefined, signal)
          } else {
            const still = join(tmp, `s${String(i).padStart(4, '0')}.jpg`)
            if (s.type === 'title') {
              const next = segs.slice(i + 1).find((x) => x.type === 'photo')
              let bg: string | null = null
              if (next) {
                bg = join(tmp, `t${i}.jpg`)
                await stillFor(db, next.item!, w, h, bg, 1)
              }
              await titleCard(s.text!, s.sub, w, h, still, bg)
              firstStillOfYear.set(i, still)
              await runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-loop', '1', '-t', d.toFixed(2), '-i', still, '-vf', `scale=${w}:${h},setsar=1,fade=t=in:st=0:d=0.4`, ...clipEnc, clip], null, () => undefined, signal)
            } else {
              const over = 1.14
              await stillFor(db, s.item!, w, h, still, over)
              const W = Math.round(w * over)
              const H = Math.round(h * over)
              // pan towards the focal point: start opposite, end on it (alternating axis)
              const dx = W - w
              const dy = H - h
              const fx = s.item!.fx
              const fy = s.item!.fy
              const horizontal = i % 2 === 0
              const x0 = horizontal ? (fx > 0.5 ? 0 : dx) : dx / 2
              const x1 = horizontal ? (fx > 0.5 ? dx : 0) : dx / 2
              const y0 = horizontal ? dy / 2 : fy > 0.5 ? 0 : dy
              const y1 = horizontal ? dy / 2 : fy > 0.5 ? dy : 0
              const ease = `(0.5-0.5*cos(PI*t/${d.toFixed(3)}))`
              const vf = `crop=${w}:${h}:x='${x0}+(${x1 - x0})*${ease}':y='${y0}+(${y1 - y0})*${ease}',setsar=1`
              await runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-loop', '1', '-framerate', String(fps), '-t', d.toFixed(2), '-i', still, '-vf', vf, ...clipEnc, clip], null, () => undefined, signal)
            }
          }
          clips[i] = clip
          done++
          onProgress((done / segs.length) * 0.8, t('Préparation des images'))
        })
      )
    )
    // 2. crossfade in batches, then join batches with crossfades too
    const xfadeChain = async (inputs: Array<{ file: string; dur: number }>, out: string): Promise<number> => {
      if (inputs.length === 1) {
        await runFfmpeg(['-hide_banner', '-v', 'error', '-y', '-i', inputs[0]!.file, '-c', 'copy', out], null, () => undefined, signal)
        return inputs[0]!.dur
      }
      const args = ['-hide_banner', '-v', 'error', '-y']
      for (const inp of inputs) args.push('-i', inp.file)
      let filter = ''
      let offset = 0
      let prev = '[0:v]'
      let total = inputs[0]!.dur
      for (let k = 1; k < inputs.length; k++) {
        offset = total - T
        const label = k === inputs.length - 1 ? '[vout]' : `[v${k}]`
        filter += `${prev}[${k}:v]xfade=transition=fade:duration=${T}:offset=${offset.toFixed(3)}${label};`
        prev = label
        total = offset + inputs[k]!.dur
      }
      args.push('-filter_complex', filter.replace(/;$/, ''), '-map', '[vout]', ...clipEnc, out)
      await runFfmpeg(args, total, () => undefined, signal)
      return total
    }
    const items = segs.map((s, i) => ({ file: clips[i]!, dur: s.seconds + T }))
    const batches: Array<{ file: string; dur: number }> = []
    const BATCH = 16
    for (let b = 0; b < items.length; b += BATCH) {
      const out = join(tmp, `b${String(b / BATCH).padStart(3, '0')}.mp4`)
      const dur = await xfadeChain(items.slice(b, b + BATCH), out)
      batches.push({ file: out, dur })
      onProgress(0.8 + ((b + BATCH) / items.length) * 0.12, 'Transitions')
    }
    const joined = join(tmp, 'joined.mp4')
    const total = await xfadeChain(batches, joined)
    // 3. final encode with music (or silence), fade in/out
    const hw = encoders.has('h264_videotoolbox') && !preview
    const final = ['-hide_banner', '-v', 'error', '-y', '-i', joined]
    if (opts.music) final.push('-stream_loop', '-1', '-i', opts.music)
    else final.push('-f', 'lavfi', '-t', total.toFixed(2), '-i', 'anullsrc=r=48000:cl=stereo')
    const fadeOut = Math.max(0, total - 1.5)
    final.push(
      '-filter_complex', `[0:v]fade=t=in:st=0:d=0.8,fade=t=out:st=${fadeOut.toFixed(2)}:d=1.5[v];[1:a]atrim=0:${total.toFixed(2)},afade=t=in:st=0:d=1.5,afade=t=out:st=${Math.max(0, total - 3).toFixed(2)}:d=3[a]`,
      '-map', '[v]', '-map', '[a]',
      ...(preview ? ['-c:v', 'libx264', '-preset', 'veryfast', '-crf', '26'] : hw ? ['-c:v', 'h264_videotoolbox', '-b:v', opts.resolution >= 2000 ? '40M' : '14M'] : ['-c:v', 'libx264', '-preset', 'medium', '-crf', '19']),
      '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-b:a', '192k', '-shortest', '-movflags', '+faststart', output
    )
    await runFfmpeg(final, total, (f) => onProgress(0.92 + f * 0.08, 'Encodage'), signal)
    return { seconds: total, segments: segs.length }
  } finally {
    await rm(tmp, { recursive: true, force: true }).catch(() => undefined)
  }
}
