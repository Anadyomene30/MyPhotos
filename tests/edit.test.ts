import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Library } from '@core/library'
import { cloneEdit, NEUTRAL } from '@shared/edit/types'
import { renderPhoto } from '@core/edit/render'

const LIB = join(process.cwd(), '.devdata/library')
const sha = (f: string): string => createHash('sha256').update(readFileSync(f)).digest('hex')

describe.runIf(existsSync(LIB))('non-destructive edits', () => {
  let dataDir: string
  let lib: Library
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-edit-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 180000)
  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('renders geometry: quarter turn, straighten and crop', async () => {
    const e = cloneEdit(NEUTRAL)
    e.geometry = { rotate: 1, straighten: 5, flipH: true, crop: { x: 0.1, y: 0.1, w: 0.5, h: 0.5 } }
    const r = await renderPhoto({ path: join(LIB, 'Divers/IMG_ROT6.JPG'), ext: 'jpg', kind: 'photo', orientation: 6, duration: null }, e, null)
    // oriented image is 900×1200; a quarter turn makes it 1200×900, straighten shrinks, crop halves
    expect(r.width).toBeGreaterThan(450)
    expect(r.width).toBeLessThan(620)
    expect(r.width / r.height).toBeCloseTo(4 / 3, 1)
  })

  it('stores edits, refreshes the thumbnail and never touches the original', async () => {
    const id = (lib.db.prepare("SELECT id FROM assets WHERE name = 'IMG_ROT6.JPG'").get() as { id: number }).id
    const before = sha(lib.assets.detail(id)!.path)
    const thumbBefore = sha((await lib.thumbnail(id, 'grid'))!)
    const e = cloneEdit(NEUTRAL)
    e.light.exposure = 1.2
    e.color.mono = true
    await lib.setEdit(id, e)
    const d = lib.assets.detail(id)!
    expect(d.edited).toBe(true)
    expect(d.webNative).toBe(false)
    expect(d.edit?.color.mono).toBe(true)
    const thumb = (await lib.thumbnail(id, 'grid'))!
    expect(sha(thumb)).not.toBe(thumbBefore)
    const stats = await sharp(thumb).stats()
    expect(Math.abs(stats.channels[0]!.mean - stats.channels[2]!.mean)).toBeLessThan(3) // grey
    expect(sha(d.path)).toBe(before)
    await lib.setEdit(id, null)
    expect(lib.assets.detail(id)!.edited).toBe(false)
  }, 60000)
})
