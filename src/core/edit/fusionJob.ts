import sharp from 'sharp'
import { openImage, type DecodeInput } from '../media/decode'
import { decodeRaw16 } from '../media/raw16'
import { alignAndCrop, alignShift, finish, fuse, type RGBImage } from './fusion'

export interface FusionRequest {
  inputs: DecodeInput[]
  /** RAW files of the inputs, same order: when given, frames are developed from them (sensor range, 16 bits) */
  raws?: string[]
  output: string
  /** 16-bit TIFF written next to the JPEG when the frames come from RAW: the fusion before finishing, for grading */
  master?: string
  maxSize: number
  /** EXIF written to the result (capture date, camera) */
  exif: { IFD0?: Record<string, string>; IFD2?: Record<string, string>; IFD3?: Record<string, string> }
  align: boolean
}

export interface FusionResult {
  width: number
  height: number
  shifts: Array<{ dx: number; dy: number }>
  /** path of the 16-bit TIFF, when one was written */
  master?: string
}

async function load(input: DecodeInput, maxSize: number, size?: { w: number; h: number }, raw?: string): Promise<RGBImage> {
  if (raw) {
    const r = await decodeRaw16(raw)
    let img = sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    img = size ? img.resize(size.w, size.h, { fit: 'fill' }) : img.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
    // rgb16 keeps sharp from reducing the samples to 8 bits on the way out
    const { data, info } = await img.toColourspace('rgb16').raw({ depth: 'ushort' }).toBuffer({ resolveWithObject: true })
    const u = new Uint16Array(data.buffer, data.byteOffset, data.length / 2)
    const f = new Float32Array(info.width * info.height * 3)
    for (let i = 0; i < f.length; i++) f[i] = u[i]! / 65535
    return { w: info.width, h: info.height, data: f }
  }
  let img = await openImage(input)
  img = size ? img.resize(size.w, size.h, { fit: 'fill' }) : img.resize({ width: maxSize, height: maxSize, fit: 'inside', withoutEnlargement: true })
  const { data, info } = await img.removeAlpha().toColourspace('srgb').raw().toBuffer({ resolveWithObject: true })
  const f = new Float32Array(info.width * info.height * 3)
  for (let i = 0; i < f.length; i++) f[i] = data[i]! / 255
  return { w: info.width, h: info.height, data: f }
}

/** Decode, align, fuse and encode a bracketed series. Heavy: run it in a worker thread. */
export async function runFusion(req: FusionRequest): Promise<FusionResult> {
  const raws = req.raws?.length === req.inputs.length ? req.raws : undefined
  const first = await load(req.inputs[0]!, req.maxSize, undefined, raws?.[0])
  const images = [first]
  for (let i = 1; i < req.inputs.length; i++) images.push(await load(req.inputs[i]!, req.maxSize, { w: first.w, h: first.h }, raws?.[i]))
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
  const blended = fuse(aligned)
  let master: string | undefined
  if (raws && req.master) {
    // the flat blend, before levels and saturation: the most latitude for grading
    const u16 = new Uint16Array(blended.w * blended.h * 3)
    for (let i = 0; i < u16.length; i++) u16[i] = Math.round(Math.min(1, Math.max(0, blended.data[i]!)) * 65535)
    await sharp(u16, { raw: { width: blended.w, height: blended.h, channels: 3 } })
      .toColourspace('rgb16')
      .tiff({ compression: 'lzw', predictor: 'horizontal' })
      .toFile(req.master)
    master = req.master
  }
  const fused = finish(blended)
  const out = Buffer.alloc(fused.w * fused.h * 3)
  for (let i = 0; i < out.length; i++) out[i] = Math.round(fused.data[i]! * 255)
  await sharp(out, { raw: { width: fused.w, height: fused.h, channels: 3 } })
    .jpeg({ quality: 93, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .withExif(req.exif)
    .toFile(req.output)
  return { width: fused.w, height: fused.h, shifts, master }
}
