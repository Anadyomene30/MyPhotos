/**
 * Justified page layout: place photos in rows so that each keeps its exact aspect ratio (no crop),
 * choosing the row split whose total height best fills the page. Coordinates are in a unit box.
 */
export interface Rect {
  x: number
  y: number
  w: number
  h: number
}

export function justify(ratios: number[], box: Rect, gap: number, maxRows = 3): Rect[] {
  const n = ratios.length
  if (!n) return []
  let best: { rows: number[][]; score: number } | null = null
  // every contiguous partition of the sequence into ≤ maxRows rows
  const recurse = (start: number, rows: number[][]): void => {
    if (start === n) {
      const heights = rows.map((r) => (box.w - gap * (r.length - 1)) / r.reduce((a, i) => a + ratios[i]!, 0))
      const total = heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1)
      // prefer filling the height; penalize rows much taller than the box and very uneven rows
      const fill = Math.abs(Math.log(total / box.h))
      const uneven = rows.length > 1 ? Math.abs(Math.log(Math.max(...heights) / Math.min(...heights))) * 0.45 : 0
      const score = fill + uneven
      if (!best || score < best.score) best = { rows: rows.map((r) => [...r]), score }
      return
    }
    if (rows.length >= maxRows) return
    for (let end = start + 1; end <= n; end++) {
      rows.push(Array.from({ length: end - start }, (_, k) => start + k))
      recurse(end, rows)
      rows.pop()
    }
  }
  recurse(0, [])
  const rows = best!.rows
  const heights = rows.map((r) => (box.w - gap * (r.length - 1)) / r.reduce((a, i) => a + ratios[i]!, 0))
  const total = heights.reduce((a, b) => a + b, 0) + gap * (rows.length - 1)
  const s = Math.min(1, box.h / total)
  const usedH = total * s
  const out: Rect[] = new Array(n)
  let y = box.y + (box.h - usedH) / 2
  rows.forEach((r, k) => {
    const h = heights[k]! * s
    const rowW = r.reduce((a, i) => a + ratios[i]! * h, 0) + gap * s * (r.length - 1)
    let x = box.x + (box.w - rowW) / 2
    for (const i of r) {
      const w = ratios[i]! * h
      out[i] = { x, y, w, h }
      x += w + gap * s
    }
    y += h + gap * s
  })
  return out
}
