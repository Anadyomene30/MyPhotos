import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { patchAssets } from '@/api/hooks'
import { useUi } from '@/store'
import { localeTag, t, tn } from '@/i18n'
import type { CleanupReport } from '@shared/types'

export function useCleanupReport() {
  const version = useUi((s) => s.version)
  return useQuery({
    queryKey: ['cleanup', version],
    queryFn: () => api<CleanupReport>('/api/cleanup'),
    placeholderData: (prev) => prev,
    staleTime: 5000
  })
}

const n = (x: number): string => x.toLocaleString(localeTag())

export async function trashIds(ids: number[]): Promise<void> {
  if (!ids.length) return
  await patchAssets(ids, { trashed: true })
  useUi.getState().toast(tn(ids.length, '{n} élément placé dans la corbeille', '{n} éléments placés dans la corbeille'), {
    label: t('Annuler'),
    run: () => void patchAssets(ids, { trashed: false })
  })
}

export async function resolveExact(groups: Array<{ keep: number; remove: number[] }>): Promise<void> {
  const r = await api<{ trashed: number; skipped: number }>('/api/cleanup/exact', { method: 'POST', json: { groups } })
  const ids = groups.flatMap((g) => g.remove)
  useUi.getState().toast(
    r.skipped
      ? t('{trashed} copie(s) vérifiée(s) et supprimée(s), {skipped} laissée(s) car différente(s)', { trashed: n(r.trashed), skipped: n(r.skipped) })
      : tn(r.trashed, '{n} copie identique placée dans la corbeille', '{n} copies identiques placées dans la corbeille'),
    { label: t('Annuler'), run: () => void patchAssets(ids, { trashed: false }) }
  )
}

export async function ignore(signature: string, kind: string): Promise<void> {
  await api('/api/cleanup/ignore', { method: 'POST', json: { signature, kind } })
}
