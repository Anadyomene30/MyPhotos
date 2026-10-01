import { isPlural, localeTag, t } from '@/i18n'

const LOCALE = localeTag()

const cap = (s: string): string => s.charAt(0).toUpperCase() + s.slice(1)

const fmtDay = new Intl.DateTimeFormat(LOCALE, { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtWeekday = new Intl.DateTimeFormat(LOCALE, { weekday: 'long', timeZone: 'UTC' })
const fmtMonth = new Intl.DateTimeFormat(LOCALE, { month: 'long', year: 'numeric', timeZone: 'UTC' })
const fmtMonthShort = new Intl.DateTimeFormat(LOCALE, { month: 'short', timeZone: 'UTC' })

/** Parse "YYYY-MM-DD" as a UTC date so calendar days never shift with the viewer's time zone. */
function dayDate(day: string): Date {
  const [y, m, d] = day.split('-').map(Number)
  return new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1))
}

export function dayLabel(day: string): { title: string; sub: string } {
  const d = dayDate(day)
  const today = new Date()
  const todayKey = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  const yest = new Date(today.getTime() - 86400000)
  const yestKey = `${yest.getFullYear()}-${String(yest.getMonth() + 1).padStart(2, '0')}-${String(yest.getDate()).padStart(2, '0')}`
  if (day === todayKey) return { title: t('Aujourd’hui'), sub: cap(fmtDay.format(d)) }
  if (day === yestKey) return { title: t('Hier'), sub: cap(fmtDay.format(d)) }
  return { title: fmtDay.format(d), sub: cap(fmtWeekday.format(d)) }
}

export function monthLabel(month: string): string {
  return cap(fmtMonth.format(dayDate(`${month}-01`)))
}

export function monthShort(month: string): string {
  return cap(fmtMonthShort.format(dayDate(`${month}-01`)).replace('.', ''))
}

export function dateTime(ms: number, tzOffset: number | null): { date: string; time: string } {
  // Show the wall-clock time where the photo was taken when the offset is known.
  if (tzOffset !== null) {
    const d = new Date(ms + tzOffset * 60000)
    return {
      date: cap(new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(d)),
      time: new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit', timeZone: 'UTC' }).format(d)
    }
  }
  const d = new Date(ms)
  return {
    date: cap(new Intl.DateTimeFormat(LOCALE, { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(d)),
    time: new Intl.DateTimeFormat(LOCALE, { hour: '2-digit', minute: '2-digit' }).format(d)
  }
}

export function duration(sec: number | null): string {
  if (sec === null || !Number.isFinite(sec)) return ''
  const s = Math.round(sec)
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const r = s % 60
  return h ? `${h}:${String(m).padStart(2, '0')}:${String(r).padStart(2, '0')}` : `${m}:${String(r).padStart(2, '0')}`
}

export function bytes(n: number): string {
  if (n < 1024) return `${n} ${t('o')}`
  const units = [t('Ko'), t('Mo'), t('Go'), t('To')]
  let v = n / 1024
  let i = 0
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024
    i++
  }
  return `${v.toLocaleString(LOCALE, { maximumFractionDigits: v < 10 ? 1 : 0 })} ${units[i]}`
}

export const count = (n: number): string => n.toLocaleString(LOCALE)

/** "3 photos": count formatted for the locale, French word forms translated. Pass the French singular and plural. */
export function plural(n: number, one: string, many: string): string {
  return `${count(n)} ${t(isPlural(n) ? many : one)}`
}

export function exposure(v: number | null): string | null {
  if (!v) return null
  return v >= 1 ? `${v.toLocaleString(LOCALE, { maximumFractionDigits: 1 })} s` : `1/${Math.round(1 / v)} s`
}
