import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs'
import { createHash } from 'node:crypto'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Library } from '@core/library'
import { readImageMetadata, readVideoMetadata } from '@core/media/metadata'
import { baseName, sanitize } from '@core/export/naming'
import { planVideo } from '@core/export/video'
import type { ExportOptions, ExportResult, ServerEvent } from '@shared/types'

const LIB = join(process.cwd(), '.devdata/library')
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

describe('naming', () => {
  it('builds safe names from patterns', () => {
    const n = { stem: 'IMG_1', takenAt: Date.UTC(2023, 7, 12, 13, 30, 5), tzOffset: 120, make: 'Apple', model: 'iPhone 15', index: 7 }
    expect(baseName({ naming: 'original' }, n)).toBe('IMG_1')
    expect(baseName({ naming: 'date' }, n)).toBe('2023-08-12 15.30.05')
    expect(baseName({ naming: 'custom', pattern: '{year}/{n}_{camera}' }, n)).toBe('2023_0007_Apple iPhone 15')
    expect(sanitize('con')).toBe('_con')
  })
  it('prefers hardware encoders with a software fallback', () => {
    const plan = planVideo('in.mov', 'out.mp4', { video: { format: 'mp4-h264', maxHeight: 720, quality: 'medium' }, metadata: 'none' }, new Set(['h264_videotoolbox', 'libx264']), 1080, null)
    expect(plan.args).toContain('h264_videotoolbox')
    expect(plan.args.join(' ')).toContain('scale=-2:720')
    expect(plan.fallback).toContain('libx264')
  })
})

describe.runIf(existsSync(LIB))('export', () => {
  let dataDir: string
  let out: string
  let lib: Library

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-exp-'))
    out = mkdtempSync(join(tmpdir(), 'myphotos-out-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 120000)

  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
    rmSync(out, { recursive: true, force: true })
  })

  const run = (opts: Partial<ExportOptions> & { ids: number[]; destination: string }): Promise<ExportResult> =>
    new Promise((resolve) => {
      const onEvent = (e: ServerEvent): void => {
        if (e.type === 'export-done') {
          lib.off('event', onEvent)
          resolve(e.result)
        }
      }
      lib.on('event', onEvent)
      lib.startExport({
        photo: { format: 'jpeg', maxSize: 800, quality: 80 },
        video: { format: 'mp4-h264', maxHeight: 360, quality: 'small' },
        metadata: 'all', naming: 'date', folders: 'yearMonth', includeLiveVideo: true, setFileDates: true,
        ...opts
      })
    })

  const idOf = (name: string): number => (lib.db.prepare('SELECT id FROM assets WHERE name = ?').get(name) as { id: number }).id

  it('refuses a destination inside the library', () => {
    expect(() => lib.startExport({ ids: [1], destination: join(LIB, 'export'), photo: { format: 'jpeg', maxSize: null, quality: 80 }, video: { format: 'original', maxHeight: null, quality: 'high' }, metadata: 'all', naming: 'original', folders: 'flat', includeLiveVideo: false, setFileDates: false })).toThrow()
  })

  it('converts photos, HEIC and videos while keeping originals intact', async () => {
    const names = ['IMG_ROT6.JPG', 'IMG_9000.HEIC', 'VID_2000.mp4']
    const ids = names.map(idOf)
    const before = ids.map((id) => sha(lib.assets.detail(id)!.path))
    const dest = join(out, 'a')
    const r = await run({ ids, destination: dest })
    expect(r.failed).toBe(0)
    expect(r.exported).toBe(3)
    const files = readdirSync(dest, { recursive: true }).map(String).filter((f) => /\.\w+$/.test(f))
    expect(files.some((f) => f.endsWith('.jpg') && f.includes('2024-07-14'))).toBe(true)
    expect(files.filter((f) => f.endsWith('.jpg')).length).toBe(2)
    expect(files.some((f) => f.endsWith('.mp4'))).toBe(true)
    expect(files.some((f) => f.toLowerCase().endsWith('.mov'))).toBe(true) // live photo video
    const rot = join(dest, files.find((f) => f.includes('2024-07-14') && f.endsWith('.jpg'))!)
    const meta = await sharp(rot).metadata()
    expect(Math.max(meta.width!, meta.height!)).toBe(800)
    expect(meta.height! > meta.width!).toBe(true) // orientation baked in
    const m = await readImageMetadata(rot, 'x.jpg', 'jpg', 0)
    expect(m.dateSource).toBe('exif')
    expect(m.day).toBe('2024-07-14')
    expect(m.lat).toBeCloseTo(43.4832, 2)
    const mp4 = join(dest, files.find((f) => f.endsWith('.mp4'))!)
    const vm = await readVideoMetadata(mp4, 'x.mp4', 0)
    expect(vm.height).toBe(360)
    expect(ids.map((id) => sha(lib.assets.detail(id)!.path))).toEqual(before)
  }, 120000)

  it('strips location and exports GIF', async () => {
    const dest = join(out, 'b')
    const r = await run({ ids: [idOf('IMG_ROT6.JPG'), idOf('VID_2001.mp4')], destination: dest, metadata: 'noLocation', folders: 'flat', naming: 'original', video: { format: 'gif', maxHeight: 240, quality: 'small' } })
    expect(r.failed).toBe(0)
    const m = await readImageMetadata(join(dest, 'IMG_ROT6.jpg'), 'IMG_ROT6.jpg', 'jpg', 0)
    expect(m.lat).toBeNull()
    expect(m.dateSource).toBe('exif')
    expect(existsSync(join(dest, 'VID_2001.gif'))).toBe(true)
  }, 120000)
})
