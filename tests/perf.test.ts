import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb, transaction, type Db } from '@core/db'
import { AssetRepo } from '@core/repo/assets'
import { buildCleanupReport } from '@core/cleanup'
import { planMoments, rebuildMoments } from '@core/organize/moments'
import { proposeMemories } from '@core/organize/memories'
import { VectorStore } from '@core/ml/vectors'

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
    // analysis, places, categories and search text, as after a full indexing
    const t1 = performance.now()
    transaction(db, () => {
      const upd = db.prepare(`UPDATE assets SET phash = ?, ph0 = ?, ph1 = ?, ph2 = ?, ph3 = ?, sharpness = ?, brightness = 0.5, clip_dark = 0, clip_bright = 0,
          contrast = 0.2, quality = ?, analyze_state = 1, width = 4000, height = 3000, ratio = 1.333, make = 'Canon', model = 'EOS',
          lat = ?, lon = ?, place_city = ?, place_country = 'France', place_cc = 'FR', geo_state = 1, ml_state = 1 WHERE id = ?`)
      const cat = db.prepare('INSERT INTO categories (asset_id, label, score) VALUES (?, ?, 0.3)')
      const txt = db.prepare('INSERT INTO search_text (asset_id, text) VALUES (?, ?)')
      const cities = ['Paris', 'Lyon', 'Biarritz', 'Gavarnie', 'Marrakech', 'Istanbul', 'Los Angeles', 'Brive']
      const labels = ['landscape', 'beach', 'food', 'pets', 'party', 'mountain']
      let seed = 7
      const rnd = (): number => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648
      let burst = 0
      for (let id = 1; id <= N; id++) {
        // bursts of 2-5 near-identical frames every ~40 photos
        if (burst === 0 && id % 40 === 0) burst = 2 + (id % 4)
        const base = burst > 0 ? Math.floor(id / 40) * 1e6 : id * 7919
        if (burst > 0) burst--
        const bands = [0, 1, 2, 3].map((k) => (base * (k + 3) + (burst > 0 ? 0 : k)) & 0xffff)
        const hex = bands.map((b) => b.toString(16).padStart(4, '0')).join('')
        const c = id % cities.length
        upd.run(hex, bands[0]!, bands[1]!, bands[2]!, bands[3]!, 50 + rnd() * 200, rnd(), 43 + c + rnd() * 0.01, 1 + c + rnd() * 0.01, cities[c]!, id)
        const label = labels[id % labels.length]!
        cat.run(id, label)
        txt.run(id, `${cities[c]} France ${label} ${2005 + Math.floor((id / N) * 21)}`)
      }
    })
    console.log(`analysis rows: ${(performance.now() - t1).toFixed(0)} ms`)
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

  it('keeps organizing, cleanup and search usable', () => {
    expect(time('moments rebuild', () => rebuildMoments(db), 1)).toBeLessThan(15000)
    expect(time('moments plan only', () => planMoments(db), 1)).toBeLessThan(5000)
    expect(time('moments buckets', () => repo.buckets({ filter: 'all', grouping: 'moments' } as never))).toBeLessThan(300)
    expect(time('cleanup report', () => buildCleanupReport(db, 1), 1)).toBeLessThan(20000)
    expect(time('memories proposal', () => proposeMemories(db, new Date(Date.UTC(2026, 5, 15))), 1)).toBeLessThan(10000)
    expect(time('category page', () => repo.page({ filter: 'all', category: 'beach' }, 0, 240))).toBeLessThan(80)
    expect(time('place page', () => repo.page({ filter: 'all', place: 'Gavarnie' }, 0, 240))).toBeLessThan(80)
    expect(time('full-text search', () => db.prepare('SELECT rowid FROM search_fts WHERE search_fts MATCH ? ORDER BY bm25(search_fts) LIMIT 400').all('"gavar"* AND "mountain"*'))).toBeLessThan(150)
  })

  it('searches 200k image vectors quickly', () => {
    const vs = new VectorStore(512, N)
    const v = new Float32Array(512)
    let seed = 3
    for (let id = 1; id <= N; id++) {
      for (let i = 0; i < 512; i++) v[i] = (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648 - 0.5
      vs.set(id, v)
    }
    expect(time('vector search 200k', () => vs.search(v, 400, 0.2))).toBeLessThan(250)
  })
})
