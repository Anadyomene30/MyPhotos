/**
 * Minimal gettext-style i18n. French is the source language and the key: `t('Photothèque')`.
 * Other languages map French strings to translations; a missing entry falls back to French.
 * Variables use `{name}`: `t('{n} sélectionnés', { n: 3 })`.
 */
import { en } from './en'

export type Locale = 'fr' | 'en'
export type LocalePref = Locale | 'auto'

const DICTS: Record<Exclude<Locale, 'fr'>, Record<string, string>> = { en }

let current: Locale = 'fr'
let tag = 'fr-FR'

/** Resolve a preference against the system language ("en-GB", "fr-CA", ...). */
export function resolveLocale(pref: LocalePref | null | undefined, system: string | undefined): { locale: Locale; tag: string } {
  const sys = (system || 'fr-FR').replace('_', '-')
  const locale: Locale = pref === 'fr' || pref === 'en' ? pref : sys.toLowerCase().startsWith('fr') ? 'fr' : 'en'
  const sysMatches = sys.toLowerCase().startsWith(locale)
  return { locale, tag: sysMatches && sys.includes('-') ? sys.split('.')[0]! : locale === 'fr' ? 'fr-FR' : 'en-US' }
}

export function setLocale(locale: Locale, intlTag?: string): void {
  current = locale
  tag = intlTag ?? (locale === 'fr' ? 'fr-FR' : 'en-US')
}

export const getLocale = (): Locale => current
/** BCP 47 tag for Intl formatters */
export const localeTag = (): string => tag

function fill(s: string, vars?: Record<string, string | number>): string {
  if (!vars) return s
  return s.replace(/\{(\w+)\}/g, (m, k: string) => (k in vars ? String(vars[k]) : m))
}

export function t(fr: string, vars?: Record<string, string | number>): string {
  const s = current === 'fr' ? fr : (DICTS[current][fr] ?? fr)
  return fill(s, vars)
}

/** Translate for an explicit locale (server-side content such as generated titles). */
export function tIn(locale: Locale, fr: string, vars?: Record<string, string | number>): string {
  const s = locale === 'fr' ? fr : (DICTS[locale][fr] ?? fr)
  return fill(s, vars)
}

/** Whether `n` takes the plural form: French treats 0 and 1 as singular, English only 1. */
export function isPlural(n: number, locale: Locale = current): boolean {
  return locale === 'fr' ? Math.abs(n) >= 2 : Math.abs(n) !== 1
}

/** `tn(3, '{n} photo', '{n} photos')`: picks the form, translates it, fills {n} (formatted) and other vars. */
export function tn(n: number, one: string, many: string, vars?: Record<string, string | number>): string {
  return t(isPlural(n) ? many : one, { n: n.toLocaleString(tag), ...vars })
}
