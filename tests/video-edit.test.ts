import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'
import { NEUTRAL_VIDEO } from '@shared/edit/video'
import { readVideoMetadata } from '@core/media/metadata'

const LIB = join(process.cwd(), '.devdata/library')

describe.runIf(existsSync(LIB))('video edits', () => {
  let dataDir: string
  let lib: Library
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-vid-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 180000)
  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('trims, speeds up, rotates and grades into a new file', async () => {
    const id = (lib.db.prepare("SELECT id FROM assets WHERE name = 'VID_2001.mp4'").get() as { id: number }).id
    const done = new Promise<{ ok: boolean; assetId: number | null; error?: string }>((resolve) => {
      const on = (e: { type: string }): void => {
        if (e.type === 'creation-done') {
          lib.off('event', on)
          resolve(e as never)
        }
      }
      lib.on('event', on)
    })
    lib.startVideoEdit(id, { ...NEUTRAL_VIDEO, trim: { start: 2, end: 8 }, speed: 2, rotate: 1, stabilize: true, color: { ...NEUTRAL_VIDEO.color, exposure: 0.5, mono: true }, output: { format: 'mp4-h264', quality: 'small', maxHeight: 480 } })
    const r = await done
    expect(r.error).toBeUndefined()
    const d = lib.assets.detail(r.assetId!)!
    const m = await readVideoMetadata(d.path, d.name, 0)
    expect(m.duration).toBeGreaterThan(2.5)
    expect(m.duration).toBeLessThan(3.6)
    expect(m.height).toBe(480)
    expect(m.width! < m.height!).toBe(true) // rotated to portrait
  }, 180000)
})
