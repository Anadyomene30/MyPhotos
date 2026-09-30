import { describe, expect, it } from 'vitest'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { alignShift, fuse, type RGBImage } from '@core/edit/fusion'
import { runFusion } from '@core/edit/fusionJob'

function scene(w: number, h: number, gain: number, shift = 0): RGBImage {
  const d = new Float32Array(w * h * 3)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = x - shift
      // bright sky on top, dark ground at the bottom, detailed pattern everywhere
      const base = y < h / 2 ? 0.9 : 0.08
      const detail = ((Math.floor(sx / 6) + Math.floor(y / 6)) % 2) * 0.08
      const v = Math.min(1, (base + detail) * gain)
      const i = (y * w + x) * 3
      d[i] = v
      d[i + 1] = v * 0.95
      d[i + 2] = v * 0.9
    }
  }
  return { w, h, data: d }
}

describe('exposure fusion', () => {
  it('recovers detail in both highlights and shadows', () => {
    const under = scene(128, 96, 0.5)
    const over = scene(128, 96, 4)
    const out = fuse([under, over])
    const lum = (img: RGBImage, y: number): number => {
      let s = 0
      for (let x = 0; x < img.w; x++) s += img.data[(y * img.w + x) * 3 + 1]!
      return s / img.w
    }
    // sky not blown out, ground not crushed
    expect(lum(out, 10)).toBeLessThan(0.95)
    expect(lum(out, 85)).toBeGreaterThan(0.12)
  })

  it('finds the translation between two exposures', () => {
    const texture = (gain: number, shift: number): RGBImage => {
      const w = 256
      const h = 192
      const d = new Float32Array(w * h * 3)
      for (let y = 0; y < h; y++) {
        for (let x = 0; x < w; x++) {
          const sx = x - shift
          const v = 0.5 + 0.25 * Math.sin(sx * 0.13 + Math.sin(y * 0.07) * 3) * Math.cos(y * 0.11 + sx * 0.021) + 0.1 * Math.sin(sx * y * 0.0007)
          const i = (y * w + x) * 3
          d[i] = d[i + 1] = d[i + 2] = Math.min(1, Math.max(0, v * gain))
        }
      }
      return { w, h, data: d }
    }
    const a = texture(1, 0)
    const b = texture(1.6, 5)
    const s = alignShift(a, b)
    expect(Math.abs(s.dx + 5)).toBeLessThanOrEqual(1) // ref(x) = img(x - dx)
    expect(Math.abs(s.dy)).toBeLessThanOrEqual(1)
  })

  it('writes a fused JPEG from files', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-fuse-'))
    const files: string[] = []
    for (const [i, g] of [0.4, 1, 3].entries()) {
      const img = scene(400, 300, g, i)
      const buf = Buffer.alloc(img.data.length)
      for (let k = 0; k < buf.length; k++) buf[k] = Math.round(img.data[k]! * 255)
      const f = join(dir, `b${i}.jpg`)
      await sharp(buf, { raw: { width: 400, height: 300, channels: 3 } }).jpeg().toFile(f)
      files.push(f)
    }
    const out = join(dir, 'hdr.jpg')
    const r = await runFusion({
      inputs: files.map((path) => ({ path, ext: 'jpg', kind: 'photo' as const, orientation: 1, duration: null })),
      output: out, maxSize: 4000, align: true, exif: { IFD2: { DateTimeOriginal: '2020:01:02 03:04:05' } }
    })
    expect(r.width).toBeGreaterThan(380)
    const m = await sharp(out).metadata()
    expect(m.format).toBe('jpeg')
  }, 60000)
})
