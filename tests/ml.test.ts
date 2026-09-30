import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdtempSync, rmSync, symlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'

const LIB = join(process.cwd(), '.devdata/library')
const MODELS = join(homedir(), '.myphotos-dev/models')
const WORKER = join(process.cwd(), 'out/main/ml-worker.js')
const ready = existsSync(LIB) && existsSync(join(MODELS, 'faces/w600k_r50.onnx')) && existsSync(join(MODELS, 'clip/onnx/vision_model_quantized.onnx')) && existsSync(WORKER)

/** Needs the fixture library, the downloaded models and a built worker (npm run build). */
describe.runIf(ready)('local intelligence', () => {
  let dataDir: string
  let lib: Library

  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-ml-'))
    symlinkSync(MODELS, join(dataDir, 'models'))
    lib = new Library({ dataDir, autoIndex: false, watch: false, workerDir: join(process.cwd(), 'out/main'), resourcesDir: join(process.cwd(), 'resources') })
    lib.ml.setEnabled(true)
    await lib.ml.ensureStarted()
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 300000)

  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('analyzes every item and geocodes them', () => {
    const st = lib.ml.status()
    expect(st.running).toEqual({ faces: true, clip: true })
    expect(st.pending).toBe(0)
    const places = lib.db.prepare('SELECT place_city, count(*) AS n FROM assets WHERE place_city IS NOT NULL GROUP BY 1 ORDER BY n DESC').all() as Array<{ place_city: string; n: number }>
    expect(places.map((p) => p.place_city)).toContain('Biarritz')
    expect(places.map((p) => p.place_city)).toContain('Paris')
  })

  it('answers text and semantic searches', async () => {
    const byName = await lib.ml.search('IMG_3403')
    expect(lib.assets.detail(byName[0]!.id)!.name).toBe('IMG_3403.JPG')
    const byPlace = await lib.ml.search('biarritz')
    expect(byPlace.length).toBeGreaterThan(5)
    for (const h of byPlace.slice(0, 5)) expect(lib.assets.detail(h.id)!.place).toBe('Biarritz')
    const semantic = await lib.ml.search('color bars test pattern video')
    expect(semantic.length).toBeGreaterThan(0)
    expect(lib.assets.detail(semantic[0]!.id)!.kind).toBe('video')
  })

  it('finds similar images and categorizes', () => {
    const first = lib.assets.page({ filter: 'all' }, 0, 1)[0]!
    const sim = lib.ml.similar(first.id, 5)
    expect(sim.length).toBeGreaterThan(0)
    expect(sim[0]!.score).toBeGreaterThan(0.7)
    const cats = (lib.db.prepare('SELECT count(*) AS n FROM categories').get() as { n: number }).n
    expect(cats).toBeGreaterThan(50)
  })
})
