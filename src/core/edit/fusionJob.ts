import sharp from 'sharp'
import { openImage, type DecodeInput } from '../media/decode'
import { alignAndCrop, alignShift, finish, fuse, type RGBImage } from './fusion'

export interface FusionRequest {
  inputs: DecodeInput[]
  output: string
  maxSize: number
  /** EXIF written to the result (capture date, camera) */
  exif: { IFD0?: Record<string, string>; IFD2?: Record<string, string>; IFD3?: Record<string, string> }
  align: boolean
}

export interface FusionResult {
  width: number
  height: number
  shifts: Array<{ dx: number; dy: number }>
}

async function load(input: DecodeInput, maxSize: number, size?: { w: number; h: number }): Promise<RGBImage> {
  let img = await openImage(input)
  img = size ? img.resize(size.w, size.h, { fit: 'fill' }) : img.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
  const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const f = new Float32Array(info.width * info.height * 3)
  for (let i = 0; i < f.length; i++) f[i] = data[i]! / 255
  return { w: info.width, h: info.height, data: f }
}

/** Decode, align, fuse and encode a bracketed series. Heavy: run it in a worker thread. */
export async function runFusion(req: FusionRequest): Promise<FusionResult> {
  const first = await load(req.inputs[0]!, req.maxSize)
  const images = [first]
  for (const inp of req.inputs.slice(1)) images.push(await load(inp, req.maxSize, { w: first.w, h: first.h }))
  // reference = median brightness frame, the most reliable for alignment
  const mean = (im: RGBImage): number => {
    let s = 0
    for (let i = 0; i < im.data.length; i += 30) s += im.data[i]!
    return s / (im.data.length / 30)
  }
  const order = images.map((im, i) => ({ i, m: mean(im) })).sort((a, b) => a.m - b.m)
  const refIdx = order[Math.floor(order.length / 2)]!.i
  let shifts = images.map(() => ({ dx: 0, dy: 0 }))
  let aligned = images
  if (req.align) {
    shifts = images.map((im, i) => (i === refIdx ? { dx: 0, dy: 0 } : alignShift(images[refIdx]!, im)))
    aligned = alignAndCrop(images, shifts)
  }
  const fused = finish(fuse(aligned))
  const out = Buffer.alloc(fused.w * fused.h * 3)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(fused.data[i]! * 255)
  await sharp(out, { raw: { width: fused.w, height: fused.h, channels: 3 } })
    .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .withExif(req.exif)
    .toFile(req.output)
  return { width: fused.w, height: fused.h, shifts }
}
