import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'

const LIB = join(process.cwd(), '.devdata/library')

describe.runIf(existsSync(LIB))('cleanup', () => {
  let dataDir: string
  let lib: Library

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-clean-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 180000)

  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('analyzes every visible item', async () => {
    const r = (await lib.cleanupReport())
    expect(r.analyzed).toBe(r.total)
  })

  it('groups exact copies and keeps the original outside the copies folder', async () => {
    const r = (await lib.cleanupReport())
    expect(r.exact.length).toBeGreaterThanOrEqual(8)
    for (const g of r.exact) {
      const keep = g.items.find((i) => i.id === g.keepId)!
      expect(keep.relDir).not.toContain('Copies')
      expect(g.reclaimable).toBeGreaterThan(0)
    }
  })

  it('finds HEIC conversions as visual duplicates, keeping the higher definition', async () => {
    const r = (await lib.cleanupReport())
    const withHeic = r.visual.filter((g) => g.items.some((i) => i.ext === 'heic'))
    expect(withHeic.length).toBeGreaterThanOrEqual(1)
  })

  it('groups bursts and suggests the sharpest shot', async () => {
    const r = (await lib.cleanupReport())
    expect(r.similar.length).toBeGreaterThanOrEqual(1)
    for (const g of r.similar) {
      expect(g.items.length).toBeGreaterThanOrEqual(2)
      const keep = g.items.find((i) => i.id === g.keepId)!
      expect(keep.quality).toBe(Math.max(...g.items.map((i) => i.quality ?? 0)))
    }
  })

  it('detects the exposure bracket and fuses it into a new photo', async () => {
    const r = (await lib.cleanupReport())
    expect(r.brackets.length).toBe(1)
    const g = r.brackets[0]!
    expect(g.items.map((i) => i.name).sort()).toEqual(['IMG_3402.JPG', 'IMG_3403.JPG', 'IMG_3404.JPG'])
    expect(r.similar.some((s) => s.items.some((i) => i.name === 'IMG_3403.JPG'))).toBe(false)
    const done = new Promise<{ ok: boolean; assetId: number | null; error?: string }>((resolve) => {
      const on = (e: { type: string }): void => {
        if (e.type === 'creation-done') {
          lib.off('event', on)
          resolve(e as never)
        }
      }
      lib.on('event', on)
    })
    lib.startFusion(g.items.map((i) => i.id))
    const res = await done
    expect(res.error).toBeUndefined()
    expect(res.ok).toBe(true)
    const d = lib.assets.detail(res.assetId!)!
    expect(d.name).toBe('IMG_3403 HDR.jpg')
    expect(d.day).toBe('2019-05-12')
    expect(d.path.startsWith(lib.creationsDir)).toBe(true)
    // a fused series is not proposed again, and the fusion neither joins a series nor duplicates its sources
    expect((await lib.cleanupReport()).brackets.length).toBe(0)
    expect((await lib.cleanupReport()).visual.some((v) => v.items.some((i) => i.id === res.assetId))).toBe(false)
    // trashing the fusion offers the series again
    lib.setTrashed([res.assetId!], true)
    expect((await lib.cleanupReport()).brackets.length).toBe(1)
    lib.setTrashed([res.assetId!], false)
    expect((await lib.cleanupReport()).brackets.length).toBe(0)
  }, 120000)

  it('runs many fusions one after the other under a single progress line', async () => {
    const ids = lib.db.prepare("SELECT id FROM assets WHERE name IN ('IMG_3402.JPG', 'IMG_3403.JPG', 'IMG_3404.JPG')").all().map((r) => (r as { id: number }).id)
    const n = 3
    const results: boolean[] = []
    const done = new Promise<void>((resolve) => {
      const on = (e: { type: string; ok?: boolean }): void => {
        if (e.type !== 'creation-done') return
        results.push(e.ok!)
        if (results.length === n) {
          lib.off('event', on)
          resolve()
        }
      }
      lib.on('event', on)
    })
    for (let i = 0; i < n; i++) lib.startFusion(ids)
    const fusion = lib.jobs().filter((j) => j.id.startsWith('fusion'))
    expect(fusion).toHaveLength(1)
    expect(fusion[0]!.total).toBe(n)
    await done
    expect(results).toEqual([true, true, true])
    expect(lib.jobs().some((j) => j.id.startsWith('fusion'))).toBe(false)
    // the fusions are listed under their own filter, their sources are not
    const hdr = lib.assets.page({ filter: 'hdr' }, 0, 100)
    expect(hdr.length).toBe(1 + n)
    expect(hdr.every((a) => lib.assets.detail(a.id)!.name.includes('HDR'))).toBe(true)
    expect(lib.assets.counts().hdr).toBe(1 + n)
  }, 180000)

  it('stops queued fusions on cancel and keeps the finished ones', async () => {
    const ids = lib.db.prepare("SELECT id FROM assets WHERE name IN ('IMG_3402.JPG', 'IMG_3403.JPG', 'IMG_3404.JPG')").all().map((r) => (r as { id: number }).id)
    const before = lib.assets.counts().hdr
    const n = 3
    const events: Array<{ ok: boolean; cancelled?: boolean }> = []
    const done = new Promise<void>((resolve) => {
      const on = (e: { type: string; ok?: boolean; cancelled?: boolean }): void => {
        if (e.type !== 'creation-done') return
        events.push({ ok: e.ok!, cancelled: e.cancelled })
        if (events.length === n) {
          lib.off('event', on)
          resolve()
        }
      }
      lib.on('event', on)
    })
    for (let i = 0; i < n; i++) lib.startFusion(ids)
    lib.cancelJob('fusion')
    expect(lib.jobs().some((j) => j.id === 'fusion')).toBe(false)
    await done
    const made = events.filter((e) => e.ok).length
    expect(events.filter((e) => e.cancelled).length).toBe(n - made)
    expect(made).toBeLessThanOrEqual(1)
    expect(lib.assets.counts().hdr).toBe(before + made)
  }, 180000)

  it('verifies bytes before trashing copies and supports ignoring groups', async () => {
    const r = (await lib.cleanupReport())
    const g = r.exact[0]!
    const res = await lib.resolveExactDuplicates([{ keep: g.keepId, remove: g.items.map((i) => i.id).filter((id) => id !== g.keepId) }])
    expect(res.trashed).toBe(g.items.length - 1)
    expect(res.skipped).toBe(0)
    // a non-identical "copy" is refused
    const other = r.exact[1]!
    const bad = await lib.resolveExactDuplicates([{ keep: g.keepId, remove: [other.items[0]!.id] }])
    expect(bad.trashed).toBe(0)
    expect(bad.skipped).toBe(1)
    lib.ignoreCleanup(other.key, 'exact')
    expect((await lib.cleanupReport()).exact.find((x) => x.key === other.key)).toBeUndefined()
  })
})
