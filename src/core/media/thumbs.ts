import { mkdir, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import sharp from 'sharp'
import { openImage, type DecodeInput } from './decode'
import { renderPhoto } from '../edit/render'
import type { PhotoEdit } from '@shared/edit/types'
import { limiter } from '../util'

export type ThumbSize = 'grid' | 'preview' | 'source'

const SPEC: Record<ThumbSize, { px: number; quality: number; fit: 'outside' | 'inside' }> = {
  /** short side 360 px: sharp on retina for grid cells up to ~180 css px */
  grid: { px: 360, quality: 72, fit: 'outside' },
  /** long side 2048 px for the viewer when the original is not web-native */
  preview: { px: 2048, quality: 84, fit: 'inside' },
  /** unedited preview used as the editor's working image */
  source: { px: 2048, quality: 88, fit: 'inside' }
}

export interface ThumbResult {
  file: string
  width: number
  height: number
}

export class ThumbStore {
  private inflight = new Map<string, Promise<ThumbResult>>()
  private onDemand = limiter(4, { lifo: true })

  constructor(private cacheDir: string) {}

  pathFor(id: number, size: ThumbSize): string {
    const shard = (id % 256).toString(16).padStart(2, '0')
    return join(this.cacheDir, size, shard, `${id}.webp`)
  }

  async remove(id: number): Promise<void> {
    const { rm } = await import('node:fs/promises')
    await Promise.all((['grid', 'preview'] as ThumbSize[]).map((s) => rm(this.pathFor(id, s), { force: true })))
  }

  async exists(id: number, size: ThumbSize): Promise<boolean> {
    try {
      await stat(this.pathFor(id, size))
      return true
    } catch {
      return false
    }
  }

  /** Generate (or join an in-flight generation of) a thumbnail. */
  generate(id: number, input: DecodeInput, size: ThumbSize, priority: 'background' | 'interactive' = 'background', edit: PhotoEdit | null = null): Promise<ThumbResult> {
    const key = `${size}:${id}`
    const existing = this.inflight.get(key)
    if (existing) return existing
    const work = async (): Promise<ThumbResult> => {
      const spec = SPEC[size]
      let pipeline
      if (edit && input.kind === 'photo') {
        const r = await renderPhoto(input, edit, spec.px, spec.fit)
        pipeline = sharp(r.data, { raw: { width: r.width, height: r.height, channels: 3 } })
      } else pipeline = await openImage(input)
      const { data, info } = await pipeline
        .resize({ width: spec.px, height: spec.px, fit: spec.fit, withoutEnlargement: true })
        .webp({ quality: spec.quality, effort: 2 })
        .toBuffer({ resolveWithObject: true })
      const file = this.pathFor(id, size)
      await mkdir(dirname(file), { recursive: true })
      const tmp = `${file}.${process.pid}.tmp`
      await writeFile(tmp, data)
      await rename(tmp, file)
      return { file, width: info.width, height: info.height }
    }
    const p = (priority === 'interactive' ? this.onDemand(work) : work()).finally(() => this.inflight.delete(key))
    this.inflight.set(key, p)
    return p
  }
}
