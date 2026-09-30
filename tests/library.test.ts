import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'

const LIB = join(process.cwd(), '.devdata/library')

describe.runIf(existsSync(LIB))('library', () => {
  let dataDir: string
  let lib: Library

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-test-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 120000)

  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('indexes every file and hides the Live Photo video', () => {
    const c = lib.assets.counts()
    const total = (lib.db.prepare('SELECT count(*) AS n FROM assets').get() as { n: number }).n
    expect(total).toBeGreaterThan(200)
    expect(c.videos).toBe(4)
    expect(c.live).toBe(1)
    expect(c.screenshots).toBe(1)
    expect(c.all).toBe(total - 1)
    const pending = lib.db.prepare('SELECT count(*) AS n FROM assets WHERE meta_state <> 1 OR (thumb_state <> 1 AND hidden = 0)').get() as { n: number }
    expect(pending.n).toBe(0)
  })

  it('finds exact duplicate candidates by quick hash', () => {
    const groups = lib.db.prepare('SELECT qhash, count(*) AS n FROM assets GROUP BY qhash HAVING n > 1').all()
    expect(groups.length).toBeGreaterThanOrEqual(8)
  })

  it('pages the timeline in the same order as its day buckets', () => {
    const q = { filter: 'all' as const }
    const buckets = lib.assets.buckets(q)
    const sum = buckets.reduce((a, b) => a + b.count, 0)
    const all = lib.assets.page(q, 0, 10000)
    expect(all.length).toBe(sum)
    let offset = 0
    for (const b of buckets) {
      const days = new Set(all.slice(offset, offset + b.count).map((t) => lib.assets.detail(t.id)!.day))
      expect([...days]).toEqual([b.day])
      offset += b.count
    }
    const target = all[37]!
    expect(lib.assets.indexOf(q, target.id)).toBe(37)
  })

  it('filters by kind and year, and trashes without touching files', () => {
    expect(lib.assets.page({ filter: 'videos' }, 0, 100).every((t) => t.kind === 'video')).toBe(true)
    const y = lib.assets.years()[0]!
    expect(lib.assets.buckets({ filter: 'all', year: y.year }).every((b) => b.day.startsWith(String(y.year)))).toBe(true)
    const first = lib.assets.page({ filter: 'all' }, 0, 1)[0]!
    lib.setTrashed([first.id], true)
    expect(lib.assets.counts().trash).toBe(1)
    expect(existsSync(lib.assets.detail(first.id)!.path)).toBe(true)
    lib.setTrashed([first.id], false)
    expect(lib.assets.counts().trash).toBe(0)
  })
})
