/** Renderer locale: chosen in the settings (stored per device), "auto" follows the system language. */
import { resolveLocale, setLocale, type LocalePref } from '@shared/i18n'

export { t, tn, getLocale, localeTag, isPlural } from '@shared/i18n'
export type { Locale, LocalePref } from '@shared/i18n'

const KEY = 'mp-locale'

export function localePref(): LocalePref {
  try {
    const v = localStorage.getItem(KEY)
    return v === 'fr' || v === 'en' ? v : 'auto'
  } catch {
    return 'auto'
  }
}

export function saveLocalePref(p: LocalePref): void {
  try {
    if (p === 'auto') localStorage.removeItem(KEY)
    else localStorage.setItem(KEY, p)
  } catch {
    /* private mode: stays for this session only */
  }
}

// evaluated before any component module: formatters below capture the right locale
const r = resolveLocale(localePref(), navigator.language)
setLocale(r.locale, r.tag)
document.documentElement.lang = r.locale
