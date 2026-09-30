/**
 * Exposure fusion (Mertens, Kautz & Van Reeth 2007) with MTB alignment (Ward 2003).
 * Pure TypeScript on Float32 RGB buffers in [0, 1]; no native dependencies.
 */

export interface RGBImage {
  w: number
  h: number
  /** interleaved RGB, 0..1 */
  data: Float32Array
}

// ---------------------------------------------------------------- pyramids

/** 5-tap binomial blur then 2× decimation. Works for any channel count. */
export function downsample(src: Float32Array, w: number, h: number, ch: number): { data: Float32Array; w: number; h: number } {
  const k = [1 / 16, 4 / 16, 6 / 16, 4 / 16, 1 / 16]
  const nw = Math.max(1, (w + 1) >> 1)
  const nh = Math.max(1, (h + 1) >> 1)
  // horizontal pass at full height, only at even columns
  const tmp = new Float32Array(nw * h * ch)
  for (let y = 0; y < h; y++) {
    for (let nx = 0; nx < nw; nx++) {
      const x = nx * 2
      for (let c = 0; c < ch; c++) {
        let s = 0
        for (let t = -2; t <= 2; t++) {
          const xx = Math.min(w - 1, Math.max(0, x + t))
          s += src[(y * w + xx) * ch + c]! * k[t + 2]!
        }
        tmp[(y * nw + nx) * ch + c] = s
      }
    }
  }
  const out = new Float32Array(nw * nh * ch)
  for (let ny = 0; ny < nh; ny++) {
    const y = ny * 2
    for (let x = 0; x < nw; x++) {
      for (let c = 0; c < ch; c++) {
        let s = 0
        for (let t = -2; t <= 2; t++) {
          const yy = Math.min(h - 1, Math.max(0, y + t))
          s += tmp[(yy * nw + x) * ch + c]! * k[t + 2]!
        }
        out[(ny * nw + x) * ch + c] = s
      }
    }
  }
  return { data: out, w: nw, h: nh }
}

/** Bilinear 2× upsampling to an exact target size. */
export function upsample(src: Float32Array, w: number, h: number, ch: number, tw: number, th: number): Float32Array {
  const out = new Float32Array(tw * th * ch)
  const sx = w / tw
  const sy = h / th
  for (let y = 0; y < th; y++) {
    const fy = Math.max(0, (y + 0.5) * sy - 0.5)
    const y0 = Math.min(h - 1, Math.floor(fy))
    const y1 = Math.min(h - 1, y0 + 1)
    const wy = fy - y0
    for (let x = 0; x < tw; x++) {
      const fx = Math.max(0, (x + 0.5) * sx - 0.5)
      const x0 = Math.min(w - 1, Math.floor(fx))
      const x1 = Math.min(w - 1, x0 + 1)
      const wx = fx - x0
      for (let c = 0; c < ch; c++) {
        const a = src[(y0 * w + x0) * ch + c]!
        const b = src[(y0 * w + x1) * ch + c]!
        const d = src[(y1 * w + x0) * ch + c]!
        const e = src[(y1 * w + x1) * ch + c]!
        out[(y * tw + x) * ch + c] = (a * (1 - wx) + b * wx) * (1 - wy) + (d * (1 - wx) + e * wx) * wy
      }
    }
  }
  return out
}

function levelsFor(w: number, h: number): number {
  return Math.max(1, Math.floor(Math.log2(Math.min(w, h))) - 3)
}

// ---------------------------------------------------------------- weights

const SIGMA2 = 2 * 0.2 * 0.2

/** Contrast × saturation × well-exposedness weight map for one image. */
export function weightMap(img: RGBImage, exps = { contrast: 1, saturation: 1, exposedness: 1 }): Float32Array {
  const { w, h, data } = img
  const gray = new Float32Array(w * h)
  for (let i = 0; i < w * h; i++) gray[i] = 0.2126 * data[i * 3]! + 0.7152 * data[i * 3 + 1]! + 0.0722 * data[i * 3 + 2]!
  const out = new Float32Array(w * h)
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const i = y * w + x
      const up = gray[(y > 0 ? y - 1 : y) * w + x]!
      const dn = gray[(y < h - 1 ? y + 1 : y) * w + x]!
      const lf = gray[y * w + (x > 0 ? x - 1 : x)]!
      const rt = gray[y * w + (x < w - 1 ? x + 1 : x)]!
      const C = Math.abs(up + dn + lf + rt - 4 * gray[i]!)
      const r = data[i * 3]!
      const g = data[i * 3 + 1]!
      const b = data[i * 3 + 2]!
      const mu = (r + g + b) / 3
      const S = Math.sqrt(((r - mu) ** 2 + (g - mu) ** 2 + (b - mu) ** 2) / 3)
      const E = Math.exp(-((r - 0.5) ** 2) / SIGMA2) * Math.exp(-((g - 0.5) ** 2) / SIGMA2) * Math.exp(-((b - 0.5) ** 2) / SIGMA2)
      out[i] = Math.pow(C, exps.contrast) * Math.pow(S, exps.saturation) * Math.pow(E, exps.exposedness) + 1e-12
    }
  }
  return out
}

// ---------------------------------------------------------------- fusion

/** Blend images of identical size. Memory: one Laplacian pyramid at a time plus the result pyramid. */
export function fuse(images: RGBImage[]): RGBImage {
  if (!images.length) throw new Error('no images')
  const { w, h } = images[0]!
  const n = w * h
  const weights = images.map((img) => weightMap(img))
  const sum = new Float32Array(n)
  for (const wm of weights) for (let i = 0; i < n; i++) sum[i] = sum[i]! + wm[i]!
  for (const wm of weights) for (let i = 0; i < n; i++) wm[i] = wm[i]! / sum[i]!

  const levels = levelsFor(w, h)
  const result: Array<{ data: Float32Array; w: number; h: number }> = []

  images.forEach((img, k) => {
    // Gaussian pyramid of the image
    const gp: Array<{ data: Float32Array; w: number; h: number }> = [{ data: img.data, w, h }]
    for (let l = 1; l < levels; l++) gp.push(downsample(gp[l - 1]!.data, gp[l - 1]!.w, gp[l - 1]!.h, 3))
    // Gaussian pyramid of the weights
    const wp: Array<{ data: Float32Array; w: number; h: number }> = [{ data: weights[k]!, w, h }]
    for (let l = 1; l < levels; l++) wp.push(downsample(wp[l - 1]!.data, wp[l - 1]!.w, wp[l - 1]!.h, 1))
    for (let l = 0; l < levels; l++) {
      const g = gp[l]!
      let lap: Float32Array
      if (l < levels - 1) {
        const nextUp = upsample(gp[l + 1]!.data, gp[l + 1]!.w, gp[l + 1]!.h, 3, g.w, g.h)
        lap = new Float32Array(g.data.length)
        for (let i = 0; i < lap.length; i++) lap[i] = g.data[i]! - nextUp[i]!
      } else lap = g.data
      const wl = wp[l]!.data
      if (!result[l]) result[l] = { data: new Float32Array(g.data.length), w: g.w, h: g.h }
      const r = result[l]!.data
      for (let p = 0; p < g.w * g.h; p++) {
        const wt = wl[p]!
        r[p * 3] = r[p * 3]! + wt * lap[p * 3]!
        r[p * 3 + 1] = r[p * 3 + 1]! + wt * lap[p * 3 + 1]!
        r[p * 3 + 2] = r[p * 3 + 2]! + wt * lap[p * 3 + 2]!
      }
    }
    weights[k] = new Float32Array(0) // release
  })

  // collapse
  let img = result[levels - 1]!
  for (let l = levels - 2; l >= 0; l--) {
    const target = result[l]!
    const up = upsample(img.data, img.w, img.h, 3, target.w, target.h)
    for (let i = 0; i < up.length; i++) up[i] = up[i]! + target.data[i]!
    img = { data: up, w: target.w, h: target.h }
  }
  for (let i = 0; i < img.data.length; i++) img.data[i] = Math.min(1, Math.max(0, img.data[i]!))
  return { w, h, data: img.data }
}

// ---------------------------------------------------------------- alignment (median threshold bitmaps)

function grayOf(img: RGBImage): Float32Array {
  const g = new Float32Array(img.w * img.h)
  for (let i = 0; i < g.length; i++) g[i] = 0.2126 * img.data[i * 3]! + 0.7152 * img.data[i * 3 + 1]! + 0.0722 * img.data[i * 3 + 2]!
  return g
}

function mtb(gray: Float32Array): { bits: Uint8Array; mask: Uint8Array } {
  const hist = new Uint32Array(256)
  for (let i = 0; i < gray.length; i++) hist[Math.min(255, Math.floor(gray[i]! * 255))]!++
  let acc = 0
  let median = 128
  for (let v = 0; v < 256; v++) {
    acc += hist[v]!
    if (acc >= gray.length / 2) {
      median = v
      break
    }
  }
  const bits = new Uint8Array(gray.length)
  const mask = new Uint8Array(gray.length)
  for (let i = 0; i < gray.length; i++) {
    const v = gray[i]! * 255
    bits[i] = v > median ? 1 : 0
    mask[i] = Math.abs(v - median) > 4 ? 1 : 0
  }
  return { bits, mask }
}

function mtbError(a: { bits: Uint8Array; mask: Uint8Array }, b: { bits: Uint8Array; mask: Uint8Array }, w: number, h: number, dx: number, dy: number): number {
  let err = 0
  for (let y = Math.max(0, dy); y < Math.min(h, h + dy); y++) {
    const yb = y - dy
    for (let x = Math.max(0, dx); x < Math.min(w, w + dx); x++) {
      const i = y * w + x
      const j = yb * w + (x - dx)
      if (a.mask[i]! & b.mask[j]!) err += a.bits[i]! ^ b.bits[j]!
    }
  }
  return err
}

/** Integer translation that best aligns `img` onto `ref` (coarse-to-fine, up to ±2^levels px). */
export function alignShift(ref: RGBImage, img: RGBImage, maxLevels = 6): { dx: number; dy: number } {
  let gr = grayOf(ref)
  let gi = grayOf(img)
  let w = ref.w
  let h = ref.h
  const pyr: Array<{ a: Float32Array; b: Float32Array; w: number; h: number }> = [{ a: gr, b: gi, w, h }]
  for (let l = 1; l < maxLevels && Math.min(w, h) > 64; l++) {
    const da = downsample(gr, w, h, 1)
    const db = downsample(gi, w, h, 1)
    gr = da.data
    gi = db.data
    w = da.w
    h = da.h
    pyr.push({ a: gr, b: gi, w, h })
  }
  let dx = 0
  let dy = 0
  for (let l = pyr.length - 1; l >= 0; l--) {
    dx *= 2
    dy *= 2
    const p = pyr[l]!
    const A = mtb(p.a)
    const B = mtb(p.b)
    let best = { dx, dy, e: Infinity }
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        const e = mtbError(A, B, p.w, p.h, dx + ox, dy + oy)
        if (e < best.e) best = { dx: dx + ox, dy: dy + oy, e }
      }
    }
    dx = best.dx
    dy = best.dy
  }
  return { dx, dy }
}

/** Shift every image onto the first and crop them all to the common area. */
export function alignAndCrop(images: RGBImage[], shifts: Array<{ dx: number; dy: number }>): RGBImage[] {
  const w = images[0]!.w
  const h = images[0]!.h
  const minX = Math.max(0, ...shifts.map((s) => s.dx))
  const maxX = Math.min(w, ...shifts.map((s) => w + s.dx))
  const minY = Math.max(0, ...shifts.map((s) => s.dy))
  const maxY = Math.min(h, ...shifts.map((s) => h + s.dy))
  const cw = Math.max(1, maxX - minX)
  const chh = Math.max(1, maxY - minY)
  return images.map((img, k) => {
    const { dx, dy } = shifts[k]!
    const out = new Float32Array(cw * chh * 3)
    for (let y = 0; y < chh; y++) {
      const sy = y + minY - dy
      for (let x = 0; x < cw; x++) {
        const sx = x + minX - dx
        const si = (sy * w + sx) * 3
        const di = (y * cw + x) * 3
        out[di] = img.data[si]!
        out[di + 1] = img.data[si + 1]!
        out[di + 2] = img.data[si + 2]!
      }
    }
    return { w: cw, h: chh, data: out }
  })
}

/** Gentle finishing: stretch levels between the 0.1 and 99.9 percentiles and add a touch of saturation. */
export function finish(img: RGBImage, saturation = 1.12, curve = 0.3): RGBImage {
  const hist = new Uint32Array(1024)
  const n = img.w * img.h
  for (let i = 0; i < n; i++) {
    const l = 0.2126 * img.data[i * 3]! + 0.7152 * img.data[i * 3 + 1]! + 0.0722 * img.data[i * 3 + 2]!
    hist[Math.min(1023, Math.floor(l * 1023))]!++
  }
  const pick = (q: number): number => {
    let acc = 0
    for (let v = 0; v < 1024; v++) {
      acc += hist[v]!
      if (acc >= n * q) return v / 1023
    }
    return 1
  }
  const lo = Math.min(0.08, pick(0.001))
  const hi = Math.max(0.92, pick(0.999))
  const scale = 1 / Math.max(1e-3, hi - lo)
  const d = img.data
  for (let i = 0; i < n; i++) {
    // levels, then a soft S-curve: fused images tend to look flat
    const sc = (v: number): number => {
      const x = Math.min(1, Math.max(0, (v - lo) * scale))
      return x + curve * (x * x * (3 - 2 * x) - x)
    }
    let r = sc(d[i * 3]!)
    let g = sc(d[i * 3 + 1]!)
    let b = sc(d[i * 3 + 2]!)
    const l = 0.2126 * r + 0.7152 * g + 0.0722 * b
    r = l + (r - l) * saturation
    g = l + (g - l) * saturation
    b = l + (b - l) * saturation
    d[i * 3] = Math.min(1, Math.max(0, r))
    d[i * 3 + 1] = Math.min(1, Math.max(0, g))
    d[i * 3 + 2] = Math.min(1, Math.max(0, b))
  }
  return img
}
