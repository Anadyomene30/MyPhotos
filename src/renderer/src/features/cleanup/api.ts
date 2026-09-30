import { useQuery } from '@tanstack/react-query'
import { api } from '@/api/client'
import { patchAssets } from '@/api/hooks'
import { useUi } from '@/store'
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

const n = (x: number): string => x.toLocaleString('fr-FR')

export async function trashIds(ids: number[]): Promise<void> {
  if (!ids.length) return
  await patchAssets(ids, { trashed: true })
  useUi.getState().toast(`${ids.length > 1 ? `${n(ids.length)} éléments placés` : '1 élément placé'} dans la corbeille`, {
    label: 'Annuler',
    run: () => void patchAssets(ids, { trashed: false })
  })
}

export async function resolveExact(groups: Array<{ keep: number; remove: number[] }>): Promise<void> {
  const r = await api<{ trashed: number; skipped: number }>('/api/cleanup/exact', { method: 'POST', json: { groups } })
  const ids = groups.flatMap((g) => g.remove)
  useUi.getState().toast(
    r.skipped
      ? `${n(r.trashed)} copie(s) vérifiée(s) et supprimée(s), ${n(r.skipped)} laissée(s) car différente(s)`
      : `${n(r.trashed)} copie${r.trashed > 1 ? 's' : ''} identique${r.trashed > 1 ? 's' : ''} placée${r.trashed > 1 ? 's' : ''} dans la corbeille`,
    { label: 'Annuler', run: () => void patchAssets(ids, { trashed: false }) }
  )
}

export async function ignore(signature: string, kind: string): Promise<void> {
  await api('/api/cleanup/ignore', { method: 'POST', json: { signature, kind } })
}
