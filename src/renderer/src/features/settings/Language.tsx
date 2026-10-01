import { Languages } from 'lucide-react'
import { Segmented } from '@/components/ui'
import { localePref, saveLocalePref, t, type LocalePref } from '@/i18n'
import { api } from '@/api/client'

/** Interface language. Changing it reloads the window (labels are resolved once at startup). */
export function LanguageSettings() {
  const pref = localePref()
  const change = (p: LocalePref): void => {
    if (p === pref) return
    saveLocalePref(p)
    void api('/api/settings/locale', { method: 'PUT', json: { pref: p, system: navigator.language } })
      .catch(() => undefined)
      .finally(() => location.reload())
  }
  return (
    <section className="flex items-center justify-between gap-3">
      <h3 className="flex items-center gap-2 text-[13px] font-semibold">
        <Languages className="size-4 text-accent" /> {t('Langue')}
      </h3>
      <Segmented<LocalePref>
        size="sm"
        value={pref}
        onChange={change}
        options={[
          { value: 'auto', label: t('Auto'), title: t('Langue du système') },
          { value: 'fr', label: 'Français' },
          { value: 'en', label: 'English' }
        ]}
      />
    </section>
  )
}
