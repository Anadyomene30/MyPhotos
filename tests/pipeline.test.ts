import { describe, expect, it } from 'vitest'
import { NEUTRAL, cloneEdit, normalizeEdit, isNeutral, FILTERS } from '@shared/edit/types'
import { renderEdit, planGeometry, autoEnhance } from '@shared/edit/pipeline'

const img = (w: number, h: number, f: (x: number, y: number) => [number, number, number]): Uint8Array => {
  const b = new Uint8Array(w * h * 3)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) b.set(f(x, y), (y * w + x) * 3)
  return b
}
const mean = (b: Uint8Array, c = 1): number => {
  let s = 0
  for (let i = c; i < b.length; i += 3) s += b[i]!
  return s / (b.length / 3)
}

describe('photo pipeline', () => {
  const grad = (): Uint8Array => img(64, 48, (x, y) => [Math.round((x / 63) * 255), Math.round((y / 47) * 200) + 20, 128])

  it('is the identity when neutral (within rounding)', () => {
    const a = grad()
    const b = Uint8Array.from(a)
    renderEdit(b, 64, 48, 3, cloneEdit(NEUTRAL))
    let maxDiff = 0
    for (let i = 0; i < a.length; i++) maxDiff = Math.max(maxDiff, Math.abs(a[i]! - b[i]!))
    expect(maxDiff).toBeLessThanOrEqual(1)
  })

  it('brightens with exposure, desaturates with mono, warms with temperature', () => {
    const e = cloneEdit(NEUTRAL)
    e.light.exposure = 1
    const b = grad()
    renderEdit(b, 64, 48, 3, e)
    expect(mean(b)).toBeGreaterThan(mean(grad()) * 1.2)

    const m = cloneEdit(NEUTRAL)
    m.color.mono = true
    const c = grad()
    renderEdit(c, 64, 48, 3, m)
    expect(Math.abs(c[300]! - c[301]!)).toBeLessThanOrEqual(1)

    const t = cloneEdit(NEUTRAL)
    t.color.temperature = 60
    const d = grad()
    renderEdit(d, 64, 48, 3, t)
    expect(mean(d, 0) - mean(d, 2)).toBeGreaterThan(mean(grad(), 0) - mean(grad(), 2))
  })

  it('lifts shadows more than highlights', () => {
    const e = cloneEdit(NEUTRAL)
    e.light.shadows = 80
    const src = img(64, 48, (x) => (x < 32 ? [30, 30, 30] : [220, 220, 220]))
    const b = Uint8Array.from(src)
    renderEdit(b, 64, 48, 3, e)
    expect(b[(24 * 64 + 5) * 3]! - 30).toBeGreaterThan(b[(24 * 64 + 60) * 3]! - 220 + 5)
  })

  it('computes straighten crops inside the rotated frame', () => {
    const p = planGeometry(4000, 3000, { rotate: 0, straighten: 10, flipH: false, crop: null })
    expect(p.width).toBeLessThan(4000)
    expect(p.width / p.height).toBeCloseTo(4 / 3, 1)
    const q = planGeometry(4000, 3000, { rotate: 1, straighten: 0, flipH: false, crop: { x: 0.25, y: 0.25, w: 0.5, h: 0.5 } })
    expect(q.width).toBe(1500)
    expect(q.height).toBe(2000)
  })

  it('normalizes partial edits and exposes presets', () => {
    expect(isNeutral(normalizeEdit({}))).toBe(true)
    const vivid = FILTERS.find((f) => f.id === 'vivid')!.apply(cloneEdit(NEUTRAL))
    expect(vivid.color.vibrance).toBeGreaterThan(0)
    expect(isNeutral(vivid)).toBe(false)
  })

  it('suggests brightening a dark image', () => {
    const dark = img(64, 48, (x, y) => [20 + (x % 10), 25 + (y % 8), 22])
    expect(autoEnhance(dark, 64, 48, 3).exposure!).toBeGreaterThan(0.3)
  })
})
