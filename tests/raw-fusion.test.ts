import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import sharp from 'sharp'
import { Library } from '@core/library'
import { decodeRaw16 } from '@core/media/raw16'

/** A real exposure series shot RAW + JPEG (Canon EOS 6D, 3 frames, 2 EV): local only, not in the repository. */
const DIR = join(process.cwd(), '.devdata/raw-bracket')

const mean = (d: Uint16Array): number => {
  let s = 0
  for (let i = 0; i < d.length; i += 97) s += d[i]!
  return s / Math.ceil(d.length / 97)
}

describe.runIf(existsSync(join(DIR, 'IMG_5444.CR2')))('HDR fusion from RAW', () => {
  let dataDir: string
  let lib: Library

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-raw-'))
    lib = new Library({
      dataDir,
      autoIndex: false,
      watch: false,
      creationsDir: join(dataDir, 'creations'),
      moveToSystemTrash: async (paths) => {
        for (const p of paths) if (!p.startsWith(DIR)) rmSync(p, { force: true })
        return []
      }
    })
    await lib.addSource(DIR)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 300000)

  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('develops a RAW to 16 bits, keeping the relative brightness of the frames', async () => {
    // auto-bracketing order: normal, under, over (1/160, 1/320, 1/80 s); sorted here from darkest to brightest
    const frames = await Promise.all(['IMG_5445', 'IMG_5444', 'IMG_5446'].map((n) => decodeRaw16(join(DIR, `${n}.CR2`))))
    for (const f of frames) {
      expect(f.data).toBeInstanceOf(Uint16Array)
      expect(f.data.length).toBe(f.width * f.height * 3)
      expect(f.width).toBeGreaterThan(5000)
    }
    const m = frames.map((f) => mean(f.data))
    expect(m[0]!).toBeLessThan(m[1]!)
    expect(m[1]!).toBeLessThan(m[2]!)
    expect(Math.max(...m)).toBeGreaterThan(255)
  }, 120000)

  it('fuses the series from its RAW files into a JPEG and a hidden 16-bit TIFF master', async () => {
    const r = await lib.cleanupReport()
    expect(r.brackets.length).toBe(1)
    const ids = r.brackets[0]!.items.map((i) => i.id)
    const done = new Promise<{ ok: boolean; assetId: number | null; error?: string }>((resolve) => {
      const on = (e: { type: string }): void => {
        if (e.type !== 'creation-done') return
        lib.off('event', on)
        resolve(e as never)
      }
      lib.on('event', on)
    })
    const before = lib.assets.counts().all
    lib.startFusion(ids)
    const res = await done
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)

    const tif = join(lib.creationsDir, 'IMG_5444 HDR.tif')
    const meta = await sharp(tif).metadata()
    expect(meta.depth).toBe('ushort')
    expect(meta.channels).toBe(3)
    expect(meta.width).toBeGreaterThan(4000) // 4096 less the few pixels alignment crops
    // only the JPEG shows in the library; the master waits in the folder for a grading tool
    expect(lib.assets.detail(res.assetId!)!.name).toBe('IMG_5444 HDR.jpg')
    expect(lib.assets.counts().all).toBe(before + 1)
    expect(lib.assets.counts().hdr).toBe(1)
    const kinds = lib.db.prepare('SELECT kind FROM creations ORDER BY kind').all().map((c) => (c as { kind: string }).kind)
    expect(kinds).toEqual(['hdr', 'hdr-master'])
    // the master is a version of the JPEG, so it follows it to the trash
    const m = lib.db.prepare('SELECT id, version_of, hidden FROM assets WHERE path = ?').get(tif) as { id: number; version_of: number; hidden: number }
    expect(m).toMatchObject({ version_of: res.assetId, hidden: 1 })
    lib.setTrashed([res.assetId!], true)
    expect((lib.db.prepare('SELECT trashed_at FROM assets WHERE id = ?').get(m.id) as { trashed_at: number | null }).trashed_at).not.toBeNull()
  }, 300000)

  it('keeps masters in a chosen folder outside the library, without one while it is missing', async () => {
    expect(() => lib.setMastersDir(join(DIR, 'masters'))).toThrow()
    const away = join(dataDir, 'external', 'Masters 16 bits')
    mkdirSync(away, { recursive: true })
    lib.setMastersDir(away)
    expect(lib.mastersDir).toBe(away)

    const fuseAgain = async (): Promise<{ ok: boolean; assetId: number | null; warning?: string }> => {
      const r = await lib.cleanupReport()
      expect(r.brackets.length).toBe(1)
      const done = new Promise<{ ok: boolean; assetId: number | null; warning?: string }>((resolve) => {
        const on = (e: { type: string }): void => {
          if (e.type !== 'creation-done') return
          lib.off('event', on)
          resolve(e as never)
        }
        lib.on('event', on)
      })
      lib.startFusion(r.brackets[0]!.items.map((i) => i.id))
      return done
    }
    // the previous test trashed its fusion, which gave the series back
    const res = await fuseAgain()
    expect(res).toMatchObject({ ok: true })
    const master = join(away, 'IMG_5444 HDR 2.tif')
    expect(existsSync(master)).toBe(true)
    expect(lib.db.prepare('SELECT 1 FROM assets WHERE path = ?').get(master)).toBeUndefined()
    // emptying the trash takes the master along with its JPEG
    lib.setTrashed([res.assetId!], true)
    await lib.emptyTrash([res.assetId!])
    expect(existsSync(master)).toBe(false)

    // disk unplugged: the HDR photo is made, without a master, and the person is told
    rmSync(away, { recursive: true, force: true })
    const offline = await fuseAgain()
    expect(offline.ok).toBe(true)
    expect(offline.warning).toMatch(/introuvable/)
    lib.setMastersDir(null)
  }, 300000)
})
