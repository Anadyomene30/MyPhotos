import type { Db } from '../db'
import { fromBlob, toBlob } from './vectors'

export const DIM = 512
/** cosine to join an existing person */
export const JOIN = 0.55
/** cosine between two unassigned faces to found a new person */
export const PAIR = 0.62
/** faces below this quality never create or join people */
export const MIN_QUALITY = 0.3

interface Centroid {
  id: number
  vec: Float32Array
  n: number
}

interface Loose {
  faceId: number
  vec: Float32Array
}

function dot(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}

function normalize(v: Float32Array): Float32Array {
  let n = 0
  for (const x of v) n += x * x
  n = Math.sqrt(n) || 1
  const out = new Float32Array(v.length)
  for (let i = 0; i < v.length; i++) out[i] = v[i]! / n
  return out
}

/**
 * Incremental face clustering: a new face joins the closest person centroid when similar enough,
 * otherwise it stays "loose"; two loose faces that match found a new person. Fully deterministic,
 * O(persons + loose) per face, no global recomputation.
 */
export class PersonClusterer {
  private centroids: Centroid[] = []
  private loose: Loose[] = []
  private readonly maxLoose = 40000

  constructor(private db: Db) {
    for (const r of db.prepare('SELECT id, centroid, n FROM persons WHERE centroid IS NOT NULL').all() as Array<{ id: number; centroid: Uint8Array; n: number }>) {
      this.centroids.push({ id: r.id, vec: fromBlob(r.centroid), n: r.n })
    }
    for (const r of db.prepare('SELECT id, emb FROM faces WHERE person_id IS NULL AND hidden = 0 AND quality >= ? ORDER BY id DESC LIMIT ?').all(MIN_QUALITY, this.maxLoose) as Array<{ id: number; emb: Uint8Array }>) {
      this.loose.push({ faceId: r.id, vec: fromBlob(r.emb) })
    }
  }

  private savePerson(c: Centroid): void {
    this.db.prepare('UPDATE persons SET centroid = ?, n = ? WHERE id = ?').run(toBlob(c.vec), c.n, c.id)
  }

  private assign(faceId: number, c: Centroid, vec: Float32Array): void {
    // running mean, bounded so early mistakes do not dominate forever
    const k = Math.min(c.n, 50)
    const merged = new Float32Array(DIM)
    for (let i = 0; i < DIM; i++) merged[i] = (c.vec[i]! * k + vec[i]!) / (k + 1)
    c.vec = normalize(merged)
    c.n += 1
    this.db.prepare('UPDATE faces SET person_id = ? WHERE id = ?').run(c.id, faceId)
    this.savePerson(c)
  }

  /** Place a freshly detected face. Returns the person id when assigned. */
  add(faceId: number, vec: Float32Array, quality: number): number | null {
    if (quality < MIN_QUALITY) return null
    let best: Centroid | null = null
    let bestScore = JOIN
    for (const c of this.centroids) {
      const s = dot(c.vec, vec)
      if (s > bestScore) {
        bestScore = s
        best = c
      }
    }
    if (best) {
      this.assign(faceId, best, vec)
      return best.id
    }
    let mate: Loose | null = null
    let mateScore = PAIR
    for (const l of this.loose) {
      const s = dot(l.vec, vec)
      if (s > mateScore) {
        mateScore = s
        mate = l
      }
    }
    if (mate) {
      const r = this.db.prepare('INSERT INTO persons (cover_face_id, n, created_at) VALUES (?, 2, ?)').run(faceId, Date.now())
      const id = Number(r.lastInsertRowid)
      const sum = new Float32Array(DIM)
      for (let i = 0; i < DIM; i++) sum[i] = mate.vec[i]! + vec[i]!
      const c: Centroid = { id, vec: normalize(sum), n: 2 }
      this.centroids.push(c)
      this.db.prepare('UPDATE faces SET person_id = ? WHERE id IN (?, ?)').run(id, faceId, mate.faceId)
      this.savePerson(c)
      this.loose = this.loose.filter((l) => l !== mate)
      return id
    }
    this.loose.unshift({ faceId, vec })
    if (this.loose.length > this.maxLoose) this.loose.length = this.maxLoose
    return null
  }

  /** Recompute a person's centroid from its faces (after merges, moves or removals). */
  recompute(personId: number): void {
    const rows = this.db.prepare('SELECT emb FROM faces WHERE person_id = ? AND hidden = 0').all(personId) as Array<{ emb: Uint8Array }>
    const c = this.centroids.find((x) => x.id === personId)
    if (!rows.length) {
      if (c) this.centroids = this.centroids.filter((x) => x !== c)
      this.db.prepare('DELETE FROM persons WHERE id = ?').run(personId)
      return
    }
    const sum = new Float32Array(DIM)
    for (const r of rows) {
      const v = fromBlob(r.emb)
      for (let i = 0; i < DIM; i++) sum[i] = sum[i]! + v[i]!
    }
    const vec = normalize(sum)
    if (c) {
      c.vec = vec
      c.n = rows.length
      this.savePerson(c)
    } else {
      const n: Centroid = { id: personId, vec, n: rows.length }
      this.centroids.push(n)
      this.savePerson(n)
    }
  }

  /** Move every face of `from` into `into` and delete `from`. */
  merge(into: number, from: number): void {
    this.db.prepare('UPDATE faces SET person_id = ? WHERE person_id = ?').run(into, from)
    this.centroids = this.centroids.filter((c) => c.id !== from)
    this.db.prepare('DELETE FROM persons WHERE id = ?').run(from)
    this.recompute(into)
  }

  /** Detach a face (wrong person). It goes back to the loose pool. */
  detach(faceId: number): void {
    const r = this.db.prepare('SELECT person_id, emb, quality FROM faces WHERE id = ?').get(faceId) as { person_id: number | null; emb: Uint8Array; quality: number } | undefined
    if (!r) return
    this.db.prepare('UPDATE faces SET person_id = NULL WHERE id = ?').run(faceId)
    if (r.person_id !== null) this.recompute(r.person_id)
    if (r.quality >= MIN_QUALITY) this.loose.unshift({ faceId, vec: fromBlob(r.emb) })
  }

  /** Unnamed people whose centroids nearly coincide are merged (auto-created duplicates). */
  mergeSimilarUnnamed(threshold = 0.72): number {
    const unnamed = new Set((this.db.prepare('SELECT id FROM persons WHERE name IS NULL').all() as Array<{ id: number }>).map((r) => r.id))
    let merges = 0
    for (let i = 0; i < this.centroids.length; i++) {
      for (let j = this.centroids.length - 1; j > i; j--) {
        const a = this.centroids[i]!
        const b = this.centroids[j]!
        if (!unnamed.has(b.id) && !unnamed.has(a.id)) continue
        if (dot(a.vec, b.vec) >= threshold) {
          const [into, from] = unnamed.has(b.id) ? [a, b] : [b, a]
          this.merge(into.id, from.id)
          merges++
          i = -1
          break
        }
      }
    }
    return merges
  }

  /** Person suggestions for a loose face (for "is this X?" prompts). */
  suggest(vec: Float32Array, min = 0.4): Array<{ personId: number; score: number }> {
    return this.centroids.map((c) => ({ personId: c.id, score: dot(c.vec, vec) })).filter((x) => x.score >= min).sort((a, b) => b.score - a.score).slice(0, 3)
  }
}
