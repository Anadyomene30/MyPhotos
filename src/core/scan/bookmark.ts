/**
 * Minimal reader for macOS bookmark data (Finder alias files written by recent macOS versions).
 * Only the target path is extracted (key 0x1004: array of path components). Never throws.
 */
const KEY_PATH = 0x1004
const TYPE_STRING = 0x0101
const TYPE_ARRAY = 0x0601
const TOC_MAGIC = 0xfffffffe

export function bookmarkTargetPath(buf: Uint8Array): string | null {
  try {
    const dv = new DataView(buf.buffer, buf.byteOffset, buf.byteLength)
    const ascii = (from: number, to: number): string => String.fromCharCode(...buf.subarray(from, to))
    if (buf.length < 64 || ascii(0, 4) !== 'book' || ascii(8, 12) !== 'mark') return null
    const hdr = dv.getUint32(16, true)
    if (hdr < 16 || hdr >= buf.length) return null
    const item = (rel: number): { type: number; start: number; len: number } | null => {
      const at = hdr + rel
      if (at + 8 > buf.length) return null
      const len = dv.getUint32(at, true)
      const type = dv.getUint32(at + 4, true)
      if (at + 8 + len > buf.length) return null
      return { type, start: at + 8, len }
    }
    let toc = hdr + dv.getUint32(hdr, true)
    for (let guard = 0; guard < 8 && toc > hdr && toc + 20 <= buf.length; guard++) {
      if (dv.getUint32(toc + 4, true) !== TOC_MAGIC) return null
      const next = dv.getUint32(toc + 12, true)
      const count = dv.getUint32(toc + 16, true)
      for (let i = 0; i < count; i++) {
        const e = toc + 20 + i * 12
        if (e + 12 > buf.length) return null
        if ((dv.getUint32(e, true) & 0x7fffffff) !== KEY_PATH) continue
        const arr = item(dv.getUint32(e + 4, true))
        if (!arr || arr.type !== TYPE_ARRAY) return null
        const parts: string[] = []
        for (let k = 0; k < arr.len; k += 4) {
          const s = item(dv.getUint32(arr.start + k, true))
          if (!s || s.type !== TYPE_STRING) return null
          parts.push(new TextDecoder().decode(buf.subarray(s.start, s.start + s.len)))
        }
        return parts.length ? '/' + parts.join('/') : null
      }
      if (!next) break
      toc = hdr + next
    }
    return null
  } catch {
    return null
  }
}
