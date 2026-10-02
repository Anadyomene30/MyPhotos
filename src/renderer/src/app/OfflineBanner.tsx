import { HardDrive } from 'lucide-react'
import { useLibraryState } from '@/api/hooks'
import { t } from '@/i18n'

/** Shown while a library folder is unreachable, typically an external disk that is not plugged in. */
export function OfflineBanner() {
  const { data } = useLibraryState()
  const off = data?.sources.filter((s) => !s.online) ?? []
  if (!off.length) return null
  const name = (p: string): string => p.split(/[\\/]/).filter(Boolean).slice(0, 3).join('/')
  return (
    <div role="status" className="absolute inset-x-0 bottom-0 z-20 flex items-center gap-2.5 border-t border-line bg-surface px-5 py-2 text-[12.5px]">
      <HardDrive className="size-4 shrink-0 text-amber-600 dark:text-amber-400" />
      <span className="min-w-0 truncate">
        {off.length === 1
          ? t('Le dossier « {name} » est introuvable, le disque est sans doute débranché. Les vignettes restent visibles ; les originaux reviennent dès qu’il est rebranché.', { name: name(off[0]!.path) })
          : t('{n} dossiers de la photothèque sont introuvables. Les vignettes restent visibles ; les originaux reviennent dès que les disques sont rebranchés.', { n: off.length })}
      </span>
    </div>
  )
}
