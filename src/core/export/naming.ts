import type { ExportOptions } from '@shared/types'

export interface NamingInput {
  stem: string
  takenAt: number
  tzOffset: number | null
  make: string | null
  model: string | null
  index: number
}

const pad = (n: number, w = 2): string => String(n).padStart(w, '0')

/** Wall-clock parts where the photo was taken (offset known) or in local time. */
export function wallParts(takenAt: number, tzOffset: number | null): { y: number; mo: number; d: number; h: number; mi: number; s: number } {
  if (tzOffset !== null) {
    const d = new Date(takenAt + tzOffset * 60000)
    return { y: d.getUTCFullYear(), mo: d.getUTCMonth() + 1, d: d.getUTCDate(), h: d.getUTCHours(), mi: d.getUTCMinutes(), s: d.getUTCSeconds() }
  }
  const d = new Date(takenAt)
  return { y: d.getFullYear(), mo: d.getMonth() + 1, d: d.getDate(), h: d.getHours(), mi: d.getMinutes(), s: d.getSeconds() }
}

const ILLEGAL = /[<>:"/\\|?*\u0000-\u001f]/g
const RESERVED = /^(con|prn|aux|nul|com\d|lpt\d)$/i

export function sanitize(name: string): string {
  let s = name.replace(ILLEGAL, '_').replace(/[. ]+$/, '').trim()
  if (!s || RESERVED.test(s)) s = `_${s}`
  return s.slice(0, 180)
}

export function baseName(opts: Pick<ExportOptions, 'naming' | 'pattern'>, n: NamingInput): string {
  const w = wallParts(n.takenAt, n.tzOffset)
  const date = `${w.y}-${pad(w.mo)}-${pad(w.d)}`
  const time = `${pad(w.h)}.${pad(w.mi)}.${pad(w.s)}`
  if (opts.naming === 'original') return sanitize(n.stem)
  const pattern = opts.naming === 'date' ? '{date} {time}' : opts.pattern || '{name}'
  const camera = [n.make, n.model?.replace(n.make ?? '', '').trim()].filter(Boolean).join(' ')
  return sanitize(
    pattern
      .replace(/\{name\}/g, n.stem)
      .replace(/\{date\}/g, date)
      .replace(/\{time\}/g, time)
      .replace(/\{year\}/g, String(w.y))
      .replace(/\{month\}/g, pad(w.mo))
      .replace(/\{day\}/g, pad(w.d))
      .replace(/\{n\}/g, pad(n.index, 4))
      .replace(/\{camera\}/g, camera || 'appareil')
  )
}

export function subFolder(folders: ExportOptions['folders'], takenAt: number, tzOffset: number | null): string[] {
  if (folders === 'flat') return []
  const w = wallParts(takenAt, tzOffset)
  return folders === 'year' ? [String(w.y)] : [String(w.y), `${w.y}-${pad(w.mo)}`]
}

/** Reserve a unique file name inside a folder ("name.jpg", "name (2).jpg", ...). */
export class NameAllocator {
  private used = new Set<string>()
  constructor(private exists: (path: string) => boolean) {}
  allocate(dir: string, base: string, ext: string, join: (...p: string[]) => string): string {
    for (let i = 1; ; i++) {
      const candidate = join(dir, `${base}${i === 1 ? '' : ` (${i})`}.${ext}`)
      const key = candidate.toLowerCase()
      if (!this.used.has(key) && !this.exists(candidate)) {
        this.used.add(key)
        return candidate
      }
    }
  }
}
