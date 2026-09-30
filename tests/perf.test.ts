import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, transaction, type Db } from '@core/db'
import { AssetRepo } from '@core/repo/assets'

const N = 200_000

/** Run with PERF=1 npm test. Checks that timeline queries stay interactive at 200k assets. */
describe.runIf(process.env.PERF === '1')('performance at 200k assets', () => {
  let dir: string
  let db: Db
  let repo: AssetRepo

  beforeAll(() => {
    dir = mkdtempSync(join(tmpdir(), 'myphotos-perf-'))
    db = openDb(join(dir, 'perf.db'))
    db.prepare("INSERT INTO sources (path, added_at) VALUES ('/perf', 0)").run()
    const t0 = performance.now()
    transaction(db, () => {
      const ins = db.prepare(`INSERT INTO assets (source_id, path, rel_dir, name, stem, ext, kind, size, mtime, taken_at, day, is_live, is_screenshot, favorite, meta_state, thumb_state, added_at)
        VALUES (1, ?, 'x', ?, ?, ?, ?, 1000, 0, ?, ?, ?, ?, ?, 1, 1, 0)`)
      const start = Date.UTC(2005, 0, 1)
      const span = Date.UTC(2026, 0, 1) - start
      for (let i = 0; i < N; i++) {
        const t = start + Math.floor((i / N) * span) + (i % 97) * 60000
        const d = new Date(t)
        const day = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`
        const video = i % 23 === 0
        ins.run(`/perf/${i}.jpg`, `${i}.jpg`, String(i), video ? 'mp4' : 'jpg', video ? 'video' : 'photo', t, day, i % 41 === 0 ? 1 : 0, i % 53 === 0 ? 1 : 0, i % 31 === 0 ? 1 : 0)
      }
    })
    db.exec('ANALYZE')
    console.log(`insert ${N}: ${(performance.now() - t0).toFixed(0)} ms`)
    repo = new AssetRepo(db)
  }, 120000)

  afterAll(() => {
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const time = (label: string, fn: () => unknown, runs = 5): number => {
    fn()
    const t0 = performance.now()
    for (let i = 0; i < runs; i++) fn()
    const ms = (performance.now() - t0) / runs
    console.log(`${label}: ${ms.toFixed(1)} ms`)
    return ms
  }

  it('keeps timeline queries fast', () => {
    for (const sql of [
      "EXPLAIN QUERY PLAN SELECT id FROM assets INDEXED BY assets_timeline WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL AND favorite = 1 ORDER BY day DESC, taken_at DESC, id DESC LIMIT 240 OFFSET 5000",
      "EXPLAIN QUERY PLAN SELECT day, count(*) FROM assets INDEXED BY assets_timeline WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL GROUP BY day ORDER BY day DESC"
    ]) console.log(JSON.stringify(db.prepare(sql).all().map((r) => (r as { detail: string }).detail)))
    expect(time('buckets all', () => repo.buckets({ filter: 'all' }))).toBeLessThan(150)
    expect(time('buckets videos', () => repo.buckets({ filter: 'all', kind: 'video' }))).toBeLessThan(150)
    expect(time('page offset 0', () => repo.page({ filter: 'all' }, 0, 240))).toBeLessThan(20)
    expect(time('page offset 150k', () => repo.page({ filter: 'all' }, 150000, 240))).toBeLessThan(80)
    expect(time('page favorites deep', () => repo.page({ filter: 'favorites' }, 5000, 240))).toBeLessThan(80)
    expect(time('counts', () => repo.counts())).toBeLessThan(150)
    expect(time('ids all', () => repo.ids({ filter: 'all' }), 2)).toBeLessThan(300)
    const id = repo.page({ filter: 'all' }, 123456, 1)[0]!.id
    expect(repo.indexOf({ filter: 'all' }, id)).toBe(123456)
    expect(time('indexOf', () => repo.indexOf({ filter: 'all' }, id))).toBeLessThan(80)
  })
})
