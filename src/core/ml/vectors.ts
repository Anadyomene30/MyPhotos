/**
 * In-memory vector store with int8 quantization (4× smaller than float32) for brute-force cosine search.
 * 200k × 512 dims ≈ 100 MB. Scores are computed in a single tight loop.
 */
export class VectorStore {
  readonly dim: number
  private ids: number[] = []
  private index = new Map<number, number>()
  private data: Int8Array
  private scales: Float32Array
  private size = 0

  constructor(dim: number, capacity = 1024) {
    this.dim = dim
    this.data = new Int8Array(capacity * dim)
    this.scales = new Float32Array(capacity)
  }

  get length(): number {
    return this.size
  }

  has(id: number): boolean {
    return this.index.has(id)
  }

  private grow(): void {
    const cap = Math.max(1024, this.scales.length * 2)
    const d = new Int8Array(cap * this.dim)
    d.set(this.data.subarray(0, this.size * this.dim))
    const s = new Float32Array(cap)
    s.set(this.scales.subarray(0, this.size))
    this.data = d
    this.scales = s
  }

  set(id: number, vec: Float32Array): void {
    let row = this.index.get(id)
    if (row === undefined) {
      if (this.size >= this.scales.length) this.grow()
      row = this.size++
      this.ids[row] = id
      this.index.set(id, row)
    }
    let max = 0
    for (let i = 0; i < this.dim; i++) max = Math.max(max, Math.abs(vec[i]!))
    const scale = max / 127 || 1
    const off = row * this.dim
    for (let i = 0; i < this.dim; i++) this.data[off + i] = Math.round(vec[i]! / scale)
    this.scales[row] = scale
  }

  remove(id: number): void {
    const row = this.index.get(id)
    if (row === undefined) return
    const last = this.size - 1
    if (row !== last) {
      this.data.copyWithin(row * this.dim, last * this.dim, (last + 1) * this.dim)
      this.scales[row] = this.scales[last]!
      const lastId = this.ids[last]!
      this.ids[row] = lastId
      this.index.set(lastId, row)
    }
    this.ids.length = last
    this.index.delete(id)
    this.size = last
  }

  /** Cosine scores of every stored vector against a normalized query (approximate through quantization). */
  scores(query: Float32Array): Float32Array {
    const out = new Float32Array(this.size)
    const dim = this.dim
    const q = query
    const d = this.data
    for (let r = 0; r < this.size; r++) {
      const off = r * dim
      let s = 0
      for (let i = 0; i < dim; i++) s += d[off + i]! * q[i]!
      out[r] = s * this.scales[r]!
    }
    return out
  }

  /** Top-k ids above a threshold, best first. */
  search(query: Float32Array, k: number, minScore = -1): Array<{ id: number; score: number }> {
    const s = this.scores(query)
    const idx: number[] = []
    for (let i = 0; i < s.length; i++) if (s[i]! >= minScore) idx.push(i)
    idx.sort((a, b) => s[b]! - s[a]!)
    return idx.slice(0, k).map((i) => ({ id: this.ids[i]!, score: s[i]! }))
  }

  idAt(row: number): number {
    return this.ids[row]!
  }
}

export function toBlob(v: Float32Array): Buffer {
  return Buffer.from(v.buffer, v.byteOffset, v.byteLength)
}

export function fromBlob(b: Uint8Array): Float32Array {
  const copy = new Uint8Array(b.byteLength)
  copy.set(b)
  return new Float32Array(copy.buffer)
}
