import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'
import { dateRangeLabel, momentTitle, rebuildMoments, segment, type MomentInput } from '@core/organize/moments'

const LIB = join(process.cwd(), '.devdata/library')
const H = 3600000
const item = (id: number, t: number, city: string | null = null, lat: number | null = null, lon: number | null = null): MomentInput => ({
  id, takenAt: t, day: new Date(t).toISOString().slice(0, 10), lat, lon, city, country: city ? 'France' : null, kind: 'photo', quality: 0.5, dateReliable: true
})

describe('moments', () => {
  it('splits on time gaps and on distance, merges tiny neighbours', () => {
    const t0 = Date.UTC(2023, 7, 12, 10)
    const items = [
      item(1, t0, 'Biarritz', 43.48, -1.56), item(2, t0 + 0.5 * H, 'Biarritz', 43.48, -1.56), item(3, t0 + 1 * H, 'Biarritz', 43.48, -1.56),
      item(4, t0 + 2 * H, 'Bayonne', 43.49, -1.47), // 8 km away, 1 h later → new moment
      item(5, t0 + 2.2 * H, 'Bayonne', 43.49, -1.47),
      item(6, t0 + 9 * H, 'Biarritz', 43.48, -1.56), // long gap → new moment
      item(7, t0 + 30 * H, 'Biarritz'), item(8, t0 + 30.1 * H, 'Biarritz')
    ]
    const m = segment(items)
    expect(m.map((x) => x.items.map((i) => i.id))).toEqual([[1, 2, 3], [4, 5], [6], [7, 8]])
    expect(m[1]!.city).toBe('Bayonne')
  })

  it('labels dates and titles in French', () => {
    expect(dateRangeLabel('2023-08-12', '2023-08-12')).toBe('12 août 2023')
    expect(dateRangeLabel('2023-08-12', '2023-08-15')).toBe('12–15 août 2023')
    expect(dateRangeLabel('2023-08-30', '2023-09-02')).toBe('30 août – 2 septembre 2023')
    expect(momentTitle({ dayStart: '2023-12-25', dayEnd: '2023-12-25', city: 'Lyon', country: 'France', homeCity: 'Lyon', n: 12 }).title).toBe('Noël à Lyon')
    expect(momentTitle({ dayStart: '2023-08-12', dayEnd: '2023-08-15', city: 'Florence', country: 'Italy', homeCity: 'Lyon', n: 40 })).toEqual({ title: 'Séjour à Florence', subtitle: 'Florence, Italy · 12–15 août 2023' })
    expect(momentTitle({ dayStart: '2023-08-13', dayEnd: '2023-08-13', city: null, country: null, homeCity: 'Lyon', n: 3 }).title).toBe('Dimanche 13 août 2023')
  })
})

describe.runIf(existsSync(LIB))('moments on the fixture library', () => {
  let dataDir: string
  let lib: Library
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-mom-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false, resourcesDir: join(process.cwd(), 'resources') })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 180000)
  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('covers every visible asset exactly once and keeps custom titles', () => {
    const r = rebuildMoments(lib.db)
    expect(r.moments).toBeGreaterThan(50)
    const visible = lib.assets.counts().all
    const covered = (lib.db.prepare('SELECT count(*) AS n FROM moment_assets').get() as { n: number }).n
    expect(covered).toBe(visible)
    const first = lib.db.prepare('SELECT id, sig, title FROM moments ORDER BY start_at DESC LIMIT 1').get() as { id: number; sig: string; title: string }
    lib.db.prepare('INSERT INTO moment_titles (sig, title) VALUES (?, ?)').run(first.sig, 'Mon titre')
    rebuildMoments(lib.db)
    expect((lib.db.prepare('SELECT title FROM moments WHERE sig = ?').get(first.sig) as { title: string }).title).toBe('Mon titre')
    const withPlace = (lib.db.prepare('SELECT count(*) AS n FROM moments WHERE city IS NOT NULL').get() as { n: number }).n
    expect(withPlace).toBeGreaterThan(20)
  })
})
