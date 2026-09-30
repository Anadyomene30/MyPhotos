import sharp from 'sharp'
import { openImage, type DecodeInput } from '../media/decode'
import { isGeometryNeutral, planGeometry, renderEdit } from '@shared/edit/pipeline'
import { normalizeEdit, isNeutral, type PhotoEdit } from '@shared/edit/types'

export interface RenderedImage {
  data: Buffer
  width: number
  height: number
}

export function parseEdit(raw: unknown): PhotoEdit | null {
  if (!raw || typeof raw !== 'string') return null
  try {
    const e = normalizeEdit(JSON.parse(raw) as Partial<PhotoEdit>)
    return isNeutral(e) ? null : e
  } catch {
    return null
  }
}

/**
 * Decode an asset, apply geometry then tone/color/detail edits, optionally limiting the long side.
 * Returns raw RGB. Downscales before editing when possible so thumbnails stay cheap.
 */
export async function renderPhoto(input: DecodeInput, edit: PhotoEdit | null, maxSize: number | null, fit: 'inside' | 'outside' = 'inside'): Promise<RenderedImage> {
  const base = await openImage(input)
  // Materialize orientation once: sharp allows a single rotation per pipeline.
  const meta = await base.clone().removeAlpha().raw().toBuffer({ resolveWithObject: true })
  let { width: w, height: h } = meta.info
  let pixels: Buffer = meta.data
  const g = edit?.geometry
  if (maxSize) {
    const plan0 = g ? planGeometry(w, h, g) : null
    const outLong = plan0 ? (fit === 'inside' ? Math.max(plan0.width, plan0.height) : Math.min(plan0.width, plan0.height)) : fit === 'inside' ? Math.max(w, h) : Math.min(w, h)
    const f = Math.min(1, (maxSize / outLong) * 1.02)
    if (f < 0.98) {
      const r = await sharp(pixels, { raw: { width: w, height: h, channels: 3 } }).resize(Math.max(1, Math.round(w * f)), Math.max(1, Math.round(h * f))).raw().toBuffer({ resolveWithObject: true })
      pixels = r.data
      w = r.info.width
      h = r.info.height
    }
  }
  if (g && !isGeometryNeutral(g)) {
    const plan = planGeometry(w, h, g)
    let img = sharp(pixels, { raw: { width: w, height: h, channels: 3 } })
    if (plan.flipH) {
      const flipped = await img.flop().raw().toBuffer()
      img = sharp(flipped, { raw: { width: w, height: h, channels: 3 } })
    }
    const rotated = await img.rotate(plan.angle, { background: { r: 0, g: 0, b: 0 } }).raw().toBuffer({ resolveWithObject: true })
    const rw = rotated.info.width
    const rh = rotated.info.height
    // sharp may round the bounding box differently; re-center our plan inside its box
    const dx = Math.round((rw - plan.bw) / 2)
    const dy = Math.round((rh - plan.bh) / 2)
    const left = Math.max(0, Math.min(rw - 1, plan.left + dx))
    const top = Math.max(0, Math.min(rh - 1, plan.top + dy))
    const cropped = await sharp(rotated.data, { raw: { width: rw, height: rh, channels: 3 } })
      .extract({ left, top, width: Math.min(plan.width, rw - left), height: Math.min(plan.height, rh - top) })
      .raw()
      .toBuffer({ resolveWithObject: true })
    pixels = cropped.data
    w = cropped.info.width
    h = cropped.info.height
  }
  if (edit) renderEdit(pixels, w, h, 3, edit)
  return { data: pixels, width: w, height: h }
}
