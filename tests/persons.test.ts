import { describe, expect, it } from 'vitest'
import { openDb } from '@core/db'
import { PersonClusterer, DIM } from '@core/ml/persons'
import { toBlob } from '@core/ml/vectors'
import { Geocoder } from '@core/geo'
import { VectorStore } from '@core/ml/vectors'
import { join } from 'node:path'

function randomUnit(seed: number): Float32Array {
  let s = seed
  const v = new Float32Array(DIM)
  for (let i = 0; i < DIM; i++) {
    s = (s * 1103515245 + 12345) % 2147483648
    v[i] = s / 2147483648 - 0.5
  }
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n)
  for (let i = 0; i < DIM; i++) v[i] = v[i]! / n
  return v
}

/** a noisy view of a base identity vector */
function variant(base: Float32Array, seed: number, noise = 0.55): Float32Array {
  const r = randomUnit(seed)
  const v = new Float32Array(DIM)
  let n = 0
  for (let i = 0; i < DIM; i++) {
    v[i] = base[i]! + r[i]! * noise
    n += v[i]! * v[i]!
  }
  n = Math.sqrt(n)
  for (let i = 0; i < DIM; i++) v[i] = v[i]! / n
  return v
}

describe('person clustering', () => {
  it('groups faces of the same identity and keeps identities apart', () => {
    const db = openDb(':memory:')
    db.prepare("INSERT INTO sources (path, added_at) VALUES ('/x', 0)").run()
    db.prepare("INSERT INTO assets (id, source_id, path, rel_dir, name, stem, ext, kind, size, mtime, taken_at, day, added_at) VALUES (1, 1, '/x/a.jpg', '', 'a.jpg', 'a', 'jpg', 'photo', 1, 0, 0, '2020-01-01', 0)").run()
    const cl = new PersonClusterer(db)
    const ids = [randomUnit(1), randomUnit(2), randomUnit(3)]
    const ins = db.prepare('INSERT INTO faces (asset_id, x, y, w, h, score, quality, emb) VALUES (1, 0, 0, 0.2, 0.2, 0.9, 0.9, ?)')
    const assigned: Array<number | null> = []
    let k = 100
    for (let round = 0; round < 6; round++) {
      for (const [p, base] of ids.entries()) {
        const v = variant(base, k++)
        const faceId = Number(ins.run(toBlob(v)).lastInsertRowid)
        assigned.push(cl.add(faceId, v, 0.9))
        void p
      }
    }
    const persons = db.prepare('SELECT id, n FROM persons').all() as Array<{ id: number; n: number }>
    expect(persons.length).toBe(3)
    for (const p of persons) expect(p.n).toBe(6)
    // faces of one identity share the same person
    const byPerson = db.prepare('SELECT person_id, count(*) AS n FROM faces GROUP BY person_id').all() as Array<{ person_id: number; n: number }>
    expect(byPerson.map((r) => r.n).sort()).toEqual([6, 6, 6])
    // low quality faces are never clustered
    expect(cl.add(Number(ins.run(toBlob(variant(ids[0]!, 999))).lastInsertRowid), variant(ids[0]!, 999), 0.1)).toBeNull()
    // merge and detach keep centroids consistent
    const [a, b] = persons
    cl.merge(a!.id, b!.id)
    expect((db.prepare('SELECT count(*) AS n FROM persons').get() as { n: number }).n).toBe(2)
    expect((db.prepare('SELECT n FROM persons WHERE id = ?').get(a!.id) as { n: number }).n).toBe(12)
    const face = db.prepare('SELECT id FROM faces WHERE person_id = ? LIMIT 1').get(a!.id) as { id: number }
    cl.detach(face.id)
    expect((db.prepare('SELECT n FROM persons WHERE id = ?').get(a!.id) as { n: number }).n).toBe(11)
    db.close()
  })
})

describe('vector store', () => {
  it('finds the nearest vectors after quantization and removals', () => {
    const vs = new VectorStore(DIM, 4)
    const base = randomUnit(7)
    for (let i = 1; i <= 50; i++) vs.set(i, i === 20 ? variant(base, 5, 0.2) : randomUnit(100 + i))
    vs.set(99, variant(base, 6, 0.1))
    vs.remove(3)
    const top = vs.search(base, 2)
    expect(top.map((t) => t.id).sort()).toEqual([20, 99])
    expect(top[0]!.score).toBeGreaterThan(0.9)
    expect(vs.length).toBe(50)
    expect(vs.has(3)).toBe(false)
  })
})

describe('geocoder', () => {
  it('names cities and countries offline', () => {
    const g = Geocoder.load(join(process.cwd(), 'resources'))
    expect(g.lookup(43.4832, -1.5586)?.city).toBe('Biarritz')
    expect(g.lookup(48.8566, 2.3522)?.city).toBe('Paris')
    expect(g.lookup(43.7696, 11.2558)).toMatchObject({ city: 'Florence', country: 'Italy' })
    expect(g.lookup(45.764, 4.8357)?.city).toBe('Lyon')
    expect(g.lookup(0, 0)).toBeNull()
  })
})
