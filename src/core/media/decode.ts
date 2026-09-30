import sharp, { type Sharp, type SharpOptions } from 'sharp'
import { extractThumbnail } from 'extract-raw-preview'
import { decodeFrame } from './ffmpeg'
import { HEIF_EXTS, RAW_EXTS, SHARP_EXTS } from './kinds'
import type { AssetKind } from '@shared/types'

sharp.cache(false)
sharp.concurrency(Math.max(1, Math.min(4, (globalThis.navigator?.hardwareConcurrency ?? 4) / 2)))

export interface DecodeInput {
  path: string
  ext: string
  kind: AssetKind
  orientation: number | null
  duration: number | null
}

/** Apply an EXIF orientation (1-8) explicitly, for decoded buffers that lost their EXIF block. */
function orient(img: Sharp, orientation: number | null): Sharp {
  switch (orientation) {
    case 2: return img.flop()
    case 3: return img.rotate(180)
    case 4: return img.flip()
    case 5: return img.rotate(90).flop()
    case 6: return img.rotate(90)
    case 7: return img.rotate(270).flop()
    case 8: return img.rotate(270)
    default: return img
  }
}

/**
 * Returns a sharp pipeline with correct orientation for any supported asset:
 * sharp natively for JPEG/PNG/WebP/TIFF/AVIF, ffmpeg for HEIC and video frames,
 * embedded JPEG preview for camera RAW.
 */
export async function openImage(input: DecodeInput): Promise<Sharp> {
  const opts: SharpOptions = { failOn: 'none', limitInputPixels: 1e9, sequentialRead: true }
  if (input.kind === 'video') {
    const seek = input.duration ? Math.min(1, input.duration * 0.1) : 0
    return sharp(await decodeFrame(input.path, { seek }), opts)
  }
  if (SHARP_EXTS.has(input.ext)) return sharp(input.path, { ...opts, pages: 1 }).rotate()
  if (HEIF_EXTS.has(input.ext)) return sharp(await decodeFrame(input.path), opts)
  if (RAW_EXTS.has(input.ext)) {
    const preview = await extractThumbnail(input.path)
    if (!preview.found) throw new Error(`No embedded preview in RAW file: ${preview.reason ?? 'unknown'}`)
    const buf = Buffer.from(preview.data)
    const embedded = await sharp(buf).metadata()
    if (embedded.orientation && embedded.orientation > 1) return sharp(buf, opts).rotate()
    return orient(sharp(buf, opts), input.orientation)
  }
  return sharp(await decodeFrame(input.path), opts)
}
