import { describe, expect, it } from 'vitest'
import { existsSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'
import { analyzeImage, hamming } from '@core/media/analyze'
import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'

const LIB = join(process.cwd(), '.devdata/library')

describe('hamming', () => {
  it('counts differing bits', () => {
    expect(hamming('0000000000000000', '0000000000000000')).toBe(0)
    expect(hamming('ffffffffffffffff', '0000000000000000')).toBe(64)
    expect(hamming('8000000000000001', '0000000000000000')).toBe(2)
  })
})

describe.runIf(existsSync(LIB))('image analysis', () => {
  it('gives near-identical hashes to resized copies and far hashes to different images', async () => {
    const files = readdirSync(join(LIB, '2023'), { recursive: true }).map(String).filter((f) => f.endsWith('.JPG')).map((f) => join(LIB, '2023', f))
    const a = files[0]!
    const b = files[5]!
    const dir = mkdtempSync(join(tmpdir(), 'mp-an-'))
    const small = join(dir, 'small.webp')
    await sharp(a).resize(300).webp({ quality: 60 }).toFile(small)
    const [ha, hs, hb] = await Promise.all([analyzeImage(a), analyzeImage(small), analyzeImage(b)])
    expect(hamming(ha.phash, hs.phash)).toBeLessThanOrEqual(4)
    expect(hamming(ha.phash, hb.phash)).toBeGreaterThan(4)
  })

  it('scores a blurred frame as less sharp', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mp-an-'))
    const src = join(LIB, 'Vidéos')
    expect(existsSync(src)).toBe(true)
    const sharpFile = join(dir, 'sharp.png')
    const blurFile = join(dir, 'blur.png')
    const pattern = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#808080' } })
      .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="600" height="400">' + Array.from({ length: 30 }, (_, i) => `<rect x="${i * 20}" y="0" width="10" height="400" fill="#000"/>`).join('') + '</svg>') }])
      .png()
      .toBuffer()
    await sharp(pattern).toFile(sharpFile)
    await sharp(pattern).blur(8).toFile(blurFile)
    const [s, b] = await Promise.all([analyzeImage(sharpFile), analyzeImage(blurFile)])
    expect(s.sharpness).toBeGreaterThan(b.sharpness * 5)
  })
})
