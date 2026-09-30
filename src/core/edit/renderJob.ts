import sharp from 'sharp'
import type { DecodeInput } from '../media/decode'
import { renderPhoto } from './render'
import type { PhotoEdit } from '@shared/edit/types'

export interface RenderRequest {
  input: DecodeInput
  edit: PhotoEdit
  output: string
  quality: number
  exif: { IFD0?: Record<string, string>; IFD2?: Record<string, string>; IFD3?: Record<string, string> }
}

/** Full-resolution edited render to a JPEG file. Heavy: run it in a worker thread. */
export async function runRender(req: RenderRequest): Promise<{ width: number; height: number }> {
  const r = await renderPhoto(req.input, req.edit, null)
  await sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
    .jpeg({ quality: req.quality, mozjpeg: true, chromaSubsampling: '4:4:4' })
    .withExif(req.exif)
    .toFile(req.output)
  return { width: r.width, height: r.height }
}
