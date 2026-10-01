import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readdirSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'
import { applyMovePlan, buildMovePlan } from '@core/organize/folders'

const LIB = join(process.cwd(), '.devdata/library')

describe.runIf(existsSync(LIB))('folder arrangement', () => {
  let dataDir: string
  let copy: string
  let lib: Library
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-fold-'))
    copy = join(dataDir, 'library')
    cpSync(LIB, copy, { recursive: true })
    lib = new Library({ dataDir: join(dataDir, 'data'), autoIndex: false, watch: false, resourcesDir: join(process.cwd(), 'resources') })
    await lib.addSource(copy)
    await lib.rescanAll()
    await lib.kickIndexer()
    await lib.ensureMoments()
  }, 240000)
  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('plans Year/Month Moment folders and moves files with their companions', async () => {
    const sourceId = lib.sources()[0]!.id
    const plan = buildMovePlan(lib.db, sourceId)
    expect(plan.items.length).toBeGreaterThan(100)
    expect(plan.sample[0]).toMatch(/^\d{4}\/\d{4}-\d{2} /)
    const live = plan.items.find((i) => i.companions.length > 0)
    expect(live).toBeDefined()
    const before = lib.assets.counts().all
    const r = await applyMovePlan(lib.db, plan.items)
    expect(r.failed).toEqual([])
    expect(r.moved).toBe(plan.items.length)
    for (const it of plan.items.slice(0, 20)) {
      expect(existsSync(it.to)).toBe(true)
      expect(existsSync(it.from)).toBe(false)
      expect(lib.assets.detail(it.assetId)!.path).toBe(it.to)
    }
    expect(existsSync(live!.companions[0]!.to)).toBe(true)
    // a rescan finds nothing new or missing
    await lib.rescanAll()
    expect(lib.assets.counts().all).toBe(before)
    expect((lib.db.prepare('SELECT count(*) AS n FROM assets WHERE missing_at IS NOT NULL').get() as { n: number }).n).toBe(0)
    expect(buildMovePlan(lib.db, sourceId).items.length).toBe(0)
    expect(readdirSync(copy).some((d) => /^\d{4}$/.test(d))).toBe(true)
  }, 120000)
})
