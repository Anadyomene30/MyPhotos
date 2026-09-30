import type { PhotoEdit } from './types'

/**
 * Photo adjustment pipeline shared by the live preview (web worker), thumbnails and full-resolution export (Node).
 * Operates on 8-bit interleaved buffers (RGB or RGBA). Local adjustments use low-resolution blurred luminance maps.
 */

const S2L = new Float32Array(256)
for (let i = 0; i < 256; i++) {
  const c = i / 255
  S2L[i] = c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)
}
const L2S_SIZE = 4096
const L2S_MAX = 4
const L2S = new Float32Array(L2S_SIZE + 1)
for (let i = 0; i <= L2S_SIZE; i++) {
  const c = (i / L2S_SIZE) * L2S_MAX
  L2S[i] = c <= 0.0031308 ? c * 12.92 : 1.055 * Math.pow(c, 1 / 2.4) - 0.055
}
const lin2srgb = (v: number): number => {
  if (v <= 0) return 0
  const f = (v / L2S_MAX) * L2S_SIZE
  const i = f | 0
  if (i >= L2S_SIZE) return L2S[L2S_SIZE]!
  const t = f - i
  return L2S[i]! * (1 - t) + L2S[i + 1]! * t
}

export interface LumMap {
  data: Float32Array
  w: number
  h: number
}

function boxBlur(src: Float32Array, w: number, h: number, r: number): Float32Array {
  if (r < 1) return src
  const tmp = new Float32Array(w * h)
  const out = new Float32Array(w * h)
  const win = 2 * r + 1
  for (let y = 0; y < h; y++) {
    let acc = 0
    for (let x = -r; x <= r; x++) acc += src[y * w + Math.min(w - 1, Math.max(0, x))]!
    for (let x = 0; x < w; x++) {
      tmp[y * w + x] = acc / win
      acc += src[y * w + Math.min(w - 1, x + r + 1)]! - src[y * w + Math.max(0, x - r)]!
    }
  }
  for (let x = 0; x < w; x++) {
    let acc = 0
    for (let y = -r; y <= r; y++) acc += tmp[Math.min(h - 1, Math.max(0, y)) * w + x]!
    for (let y = 0; y < h; y++) {
      out[y * w + x] = acc / win
      acc += tmp[Math.min(h - 1, y + r + 1) * w + x]! - tmp[Math.max(0, y - r) * w + x]!
    }
  }
  return out
}

/** Low-resolution luminance of the image, blurred at two scales (large for shadows/highlights, medium for clarity). */
export function luminanceMaps(src: ArrayLike<number>, w: number, h: number, ch: number): { large: LumMap; medium: LumMap } {
  const target = 256
  const scale = Math.max(1, Math.max(w, h) / target)
  const mw = Math.max(1, Math.round(w / scale))
  const mh = Math.max(1, Math.round(h / scale))
  const lum = new Float32Array(mw * mh)
  const cnt = new Float32Array(mw * mh)
  const step = Math.max(1, Math.floor(scale / 2))
  for (let y = 0; y < h; y += step) {
    const my = Math.min(mh - 1, Math.floor(y / scale))
    for (let x = 0; x < w; x += step) {
      const mx = Math.min(mw - 1, Math.floor(x / scale))
      const i = (y * w + x) * ch
      const l = (0.2126 * src[i]! + 0.7152 * src[i + 1]! + 0.0722 * src[i + 2]!) / 255
      lum[my * mw + mx]! += l
      cnt[my * mw + mx]! += 1
    }
  }
  for (let i = 0; i < lum.length; i++) lum[i] = cnt[i]! ? lum[i]! / cnt[i]! : 0.5
  const big = Math.max(1, Math.round(Math.max(mw, mh) / 18))
  const mid = Math.max(1, Math.round(Math.max(mw, mh) / 60))
  return {
    large: { data: boxBlur(boxBlur(lum, mw, mh, big), mw, mh, big), w: mw, h: mh },
    medium: { data: boxBlur(boxBlur(lum, mw, mh, mid), mw, mh, mid), w: mw, h: mh }
  }
}

function sample(m: LumMap, u: number, v: number): number {
  const fx = Math.min(m.w - 1, Math.max(0, u * m.w - 0.5))
  const fy = Math.min(m.h - 1, Math.max(0, v * m.h - 0.5))
  const x0 = fx | 0
  const y0 = fy | 0
  const x1 = Math.min(m.w - 1, x0 + 1)
  const y1 = Math.min(m.h - 1, y0 + 1)
  const tx = fx - x0
  const ty = fy - y0
  const d = m.data
  return (d[y0 * m.w + x0]! * (1 - tx) + d[y0 * m.w + x1]! * tx) * (1 - ty) + (d[y1 * m.w + x0]! * (1 - tx) + d[y1 * m.w + x1]! * tx) * ty
}

const clamp01 = (v: number): number => (v < 0 ? 0 : v > 1 ? 1 : v)
const hash = (x: number, y: number): number => {
  let n = (x * 374761393 + y * 668265263) | 0
  n = (n ^ (n >>> 13)) * 1274126177
  return ((n ^ (n >>> 16)) & 0xffff) / 0xffff - 0.5
}

/**
 * Tone and color adjustments, per pixel. `src` and `dst` may be the same buffer.
 * Rows [y0, y1) are processed so large images can be handled in slices; maps cover the whole image.
 */
export function applyTone(
  src: ArrayLike<number>,
  dst: { [i: number]: number; length: number },
  w: number,
  h: number,
  ch: number,
  e: PhotoEdit,
  maps: { large: LumMap; medium: LumMap },
  y0 = 0,
  y1 = h
): void {
  const L = e.light
  const C = e.color
  const t = C.temperature / 100
  const rGain = 1 + t * 0.22
  const bGain = 1 - t * 0.22
  const gGain = 1 - (C.tint / 100) * 0.18
  const expo = Math.pow(2, L.exposure)
  const bp = (-L.blacks / 100) * 0.12
  const wp = 1 - (L.whites / 100) * 0.12
  const lv = 1 / Math.max(0.05, wp - bp)
  const sh = (L.shadows + L.brilliance * 0.6) / 100
  const hi = (L.highlights - L.brilliance * 0.45) / 100
  const clar = e.detail.clarity / 100
  const con = L.contrast / 100
  const sat = 1 + C.saturation / 100
  const vib = C.vibrance / 100
  const fade = e.effects.fade / 100
  const vig = e.effects.vignette / 100
  const grain = e.effects.grain / 100
  const needLocal = sh !== 0 || hi !== 0 || clar !== 0
  const aspect = w / h

  for (let y = y0; y < y1; y++) {
    const v = (y + 0.5) / h
    for (let x = 0; x < w; x++) {
      const i = (y * w + x) * ch
      // white balance and exposure in linear light
      let r = lin2srgb(S2L[src[i]! | 0]! * rGain * expo)
      let g = lin2srgb(S2L[src[i + 1]! | 0]! * gGain * expo)
      let b = lin2srgb(S2L[src[i + 2]! | 0]! * bGain * expo)
      // black / white points
      r = (r - bp) * lv
      g = (g - bp) * lv
      b = (b - bp) * lv
      let l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (needLocal && l > 0) {
        const u = (x + 0.5) / w
        const lb = clamp01(sample(maps.large, u, v))
        let dl = 0
        if (sh !== 0) dl += sh * 0.55 * (1 - lb) * (1 - lb) * (1 - Math.min(1, l))
        if (hi !== 0) dl += hi * 0.55 * lb * lb * Math.min(1, l)
        if (clar !== 0) {
          const lm = sample(maps.medium, u, v)
          const mid = 1 - (2 * l - 1) * (2 * l - 1)
          dl += clar * 0.7 * (l - lm) * Math.max(0, mid)
        }
        const nl = Math.max(0, l + dl)
        if (l > 0.02) {
          const k = nl / l
          r *= k
          g *= k
          b *= k
        } else {
          r += dl
          g += dl
          b += dl
        }
        l = nl
      }
      // contrast: smooth S-curve when increasing, linear flattening when decreasing
      if (con !== 0) {
        if (con > 0) {
          const s = (c: number): number => { const z = clamp01(c); return c + con * 1.4 * (z * z * (3 - 2 * z) - z) }
          r = s(r); g = s(g); b = s(b)
        } else {
          const k = 1 + con * 0.65
          r = 0.5 + (r - 0.5) * k; g = 0.5 + (g - 0.5) * k; b = 0.5 + (b - 0.5) * k
        }
      }
      // saturation, vibrance, monochrome
      l = 0.2126 * r + 0.7152 * g + 0.0722 * b
      if (C.mono) {
        r = g = b = l
      } else if (sat !== 1 || vib !== 0) {
        const mx = Math.max(r, g, b)
        const mn = Math.min(r, g, b)
        const s0 = mx - mn
        const f = Math.max(0, sat + vib * (1 - Math.min(1, s0 * 1.6)) * 0.9)
        r = l + (r - l) * f
        g = l + (g - l) * f
        b = l + (b - l) * f
      }
      if (fade) {
        r = r * (1 - fade * 0.14) + fade * 0.07
        g = g * (1 - fade * 0.14) + fade * 0.07
        b = b * (1 - fade * 0.14) + fade * 0.075
      }
      if (vig) {
        const dx = ((x + 0.5) / w - 0.5) * Math.min(1, aspect)
        const dy = (v - 0.5) / Math.max(1, aspect) * Math.max(1, aspect)
        const d = Math.min(1, Math.sqrt(dx * dx + dy * dy) * 1.414)
        const m = d < 0.35 ? 0 : ((d - 0.35) / 0.65) ** 2
        const k = 1 + vig * 0.75 * m
        r *= k
        g *= k
        b *= k
      }
      if (grain) {
        const n = hash(x, y) * grain * 0.09
        r += n
        g += n
        b += n
      }
      dst[i] = Math.round(clamp01(r) * 255)
      dst[i + 1] = Math.round(clamp01(g) * 255)
      dst[i + 2] = Math.round(clamp01(b) * 255)
      if (ch === 4) dst[i + 3] = src[i + 3]!
    }
  }
}

/** Sharpening (unsharp mask, radius 1) and edge-aware noise reduction, on a whole buffer. */
export function applyDetail(buf: { [i: number]: number; length: number }, w: number, h: number, ch: number, sharpness: number, noise: number): void {
  const s = sharpness / 100
  const n = noise / 100
  if (!s && !n) return
  const copy = Uint8Array.from(buf as ArrayLike<number>)
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = (y * w + x) * ch
      for (let c = 0; c < 3; c++) {
        const o = copy[i + c]!
        const blur =
          (copy[i + c - ch]! + copy[i + c + ch]! + copy[i + c - w * ch]! + copy[i + c + w * ch]! + copy[i + c]! * 4 +
            copy[i + c - ch - w * ch]! + copy[i + c + ch - w * ch]! + copy[i + c - ch + w * ch]! + copy[i + c + ch + w * ch]!) / 12
        let v = o
        if (n) {
          const edge = Math.exp(-Math.abs(o - blur) / 10)
          v = v + (blur - v) * n * edge
        }
        if (s) v = v + (o - blur) * s * 1.6
        buf[i + c] = v < 0 ? 0 : v > 255 ? 255 : Math.round(v)
      }
    }
  }
}

/** Full pipeline on an already geometrically transformed buffer. */
export function renderEdit(src: { [i: number]: number; length: number }, w: number, h: number, ch: number, e: PhotoEdit): void {
  const maps = luminanceMaps(src as ArrayLike<number>, w, h, ch)
  applyTone(src as ArrayLike<number>, src, w, h, ch, e, maps)
  applyDetail(src, w, h, ch, e.detail.sharpness, e.detail.noise)
}

// ---------------------------------------------------------------- geometry

export interface GeometryPlan {
  /** total rotation in degrees applied after the optional horizontal flip */
  angle: number
  flipH: boolean
  /** size after the quarter turns (before straightening) */
  w1: number
  h1: number
  /** bounding box of the rotated image */
  bw: number
  bh: number
  /** crop rectangle inside the bounding box, in pixels */
  left: number
  top: number
  width: number
  height: number
}

/** Shared geometry math: quarter turns + straighten (auto-inscribed) + user crop. */
export function planGeometry(w0: number, h0: number, g: PhotoEdit['geometry']): GeometryPlan {
  const odd = g.rotate % 2 === 1
  const w1 = odd ? h0 : w0
  const h1 = odd ? w0 : h0
  const th = (Math.abs(g.straighten) * Math.PI) / 180
  const c = Math.cos(th)
  const s = Math.sin(th)
  const bw = w1 * c + h1 * s
  const bh = w1 * s + h1 * c
  const k = th === 0 ? 1 : Math.min(w1 / (w1 * c + h1 * s), h1 / (w1 * s + h1 * c))
  const iw = w1 * k
  const ih = h1 * k
  const ix = (bw - iw) / 2
  const iy = (bh - ih) / 2
  const cr = g.crop ?? { x: 0, y: 0, w: 1, h: 1 }
  const left = Math.max(0, Math.round(ix + cr.x * iw))
  const top = Math.max(0, Math.round(iy + cr.y * ih))
  const width = Math.max(1, Math.min(Math.round(cr.w * iw), Math.floor(bw) - left))
  const height = Math.max(1, Math.min(Math.round(cr.h * ih), Math.floor(bh) - top))
  return { angle: g.rotate * 90 + g.straighten, flipH: g.flipH, w1, h1, bw: Math.round(bw), bh: Math.round(bh), left, top, width, height }
}

export function isGeometryNeutral(g: PhotoEdit['geometry']): boolean {
  return g.rotate === 0 && g.straighten === 0 && !g.flipH && !g.crop
}

// ---------------------------------------------------------------- auto enhance

/** Suggest adjustments from the image statistics: exposure to a pleasant mid-tone, stretched levels, a little vibrance. */
export function autoEnhance(src: ArrayLike<number>, w: number, h: number, ch: number): Partial<PhotoEdit['light']> & { vibrance: number } {
  const hist = new Uint32Array(256)
  let n = 0
  const step = Math.max(1, Math.floor((w * h) / 200000))
  for (let p = 0; p < w * h; p += step) {
    const i = p * ch
    hist[Math.round(0.2126 * src[i]! + 0.7152 * src[i + 1]! + 0.0722 * src[i + 2]!)]!++
    n++
  }
  const q = (f: number): number => {
    let acc = 0
    for (let v = 0; v < 256; v++) {
      acc += hist[v]!
      if (acc >= n * f) return v / 255
    }
    return 1
  }
  const lo = q(0.005)
  const med = q(0.5)
  const hi = q(0.995)
  const exposure = Math.max(-1, Math.min(1, Math.log2(0.46 / Math.max(0.05, med)) * 0.6))
  const shadowsDark = q(0.2) < 0.12
  const highlightsHot = q(0.95) > 0.97
  return {
    exposure: Math.round(exposure * 100) / 100,
    blacks: lo > 0.04 ? -Math.round(Math.min(40, lo * 250)) : 0,
    whites: hi < 0.93 ? Math.round(Math.min(40, (0.97 - hi) * 250)) : 0,
    shadows: shadowsDark ? 22 : 8,
    highlights: highlightsHot ? -28 : -8,
    contrast: 8,
    vibrance: 18
  }
}
