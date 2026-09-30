import sharp from 'sharp'

export interface ImageAnalysis {
  /** 64-bit perceptual hash (DCT), hex */
  phash: string
  /** four 16-bit bands of the hash, for multi-index lookups */
  bands: [number, number, number, number]
  /** variance of the Laplacian on a 256 px grey version: higher is sharper */
  sharpness: number
  /** mean luminance 0..1 */
  brightness: number
  /** fraction of near-black and near-white pixels */
  clipDark: number
  clipBright: number
  /** standard deviation of luminance 0..1 */
  contrast: number
}

const N = 32
const COS: Float64Array = (() => {
  const t = new Float64Array(N * N)
  for (let u = 0; u < N; u++) for (let x = 0; x < N; x++) t[u * N + x] = Math.cos(((2 * x + 1) * u * Math.PI) / (2 * N))
  return t
})()

/** Classic pHash: 32×32 grey → 2D DCT → top-left 8×8 (without DC) → median threshold. */
export function phashFromGrey32(px: Uint8Array): { hex: string; bands: [number, number, number, number] } {
  const rows = new Float64Array(N * 8)
  // DCT along x, keep 8 lowest frequencies
  for (let y = 0; y < N; y++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0
      for (let x = 0; x < N; x++) sum += px[y * N + x]! * COS[u * N + x]!
      rows[y * 8 + u] = sum
    }
  }
  const coeffs: number[] = []
  for (let v = 0; v < 8; v++) {
    for (let u = 0; u < 8; u++) {
      let sum = 0
      for (let y = 0; y < N; y++) sum += rows[y * 8 + u]! * COS[v * N + y]!
      coeffs.push(sum)
    }
  }
  const ac = coeffs.slice(1)
  const sorted = [...ac].sort((a, b) => a - b)
  const median = sorted[Math.floor(sorted.length / 2)]!
  let bits = 0n
  for (let i = 0; i < 64; i++) {
    const c = i === 0 ? coeffs[0]! : ac[i - 1]!
    const on = i === 0 ? c > median * 2 : c > median
    if (on) bits |= 1n << BigInt(63 - i)
  }
  const hex = bits.toString(16).padStart(16, '0')
  const bands: [number, number, number, number] = [0, 1, 2, 3].map((k) => parseInt(hex.slice(k * 4, k * 4 + 4), 16)) as [number, number, number, number]
  return { hex, bands }
}

export async function analyzeImage(file: string): Promise<ImageAnalysis> {
  const base = sharp(file, { failOn: 'none' }).greyscale()
  const [small, mid] = await Promise.all([
    base.clone().resize(N, N, { fit: 'fill', kernel: 'lanczos3' }).raw().toBuffer(),
    base.clone().resize(256, 256, { fit: 'inside' }).raw().toBuffer({ resolveWithObject: true })
  ])
  const { hex, bands } = phashFromGrey32(new Uint8Array(small))
  const { data, info } = mid
  const w = info.width
  const h = info.height
  let sum = 0
  let sq = 0
  let dark = 0
  let bright = 0
  for (let i = 0; i < data.length; i++) {
    const v = data[i]!
    sum += v
    sq += v * v
    if (v <= 8) dark++
    else if (v >= 247) bright++
  }
  // Laplacian variance
  let lsum = 0
  let lsq = 0
  let n = 0
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x
      const l = data[i - w]! + data[i + w]! + data[i - 1]! + data[i + 1]! - 4 * data[i]!
      lsum += l
      lsq += l * l
      n++
    }
  }
  const mean = n ? lsum / n : 0
  const sharpness = n ? lsq / n - mean * mean : 0
  const total = data.length || 1
  const m = sum / total
  const contrast = Math.sqrt(Math.max(0, sq / total - m * m)) / 255
  return { phash: hex, bands, sharpness, brightness: m / 255, clipDark: dark / total, clipBright: bright / total, contrast }
}

/** Hamming distance between two 64-bit hex hashes. */
export function hamming(a: string, b: string): number {
  let d = 0
  for (let k = 0; k < 16; k += 8) {
    let x = (parseInt(a.slice(k, k + 8), 16) ^ parseInt(b.slice(k, k + 8), 16)) >>> 0
    x -= (x >>> 1) & 0x55555555
    x = (x & 0x33333333) + ((x >>> 2) & 0x33333333)
    d += (((x + (x >>> 4)) & 0x0f0f0f0f) * 0x01010101) >>> 24
  }
  return d
}
