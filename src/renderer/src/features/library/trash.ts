import { api } from '@/api/client'
import { confirm } from '@/components/Confirm'
import { useUi } from '@/store'

/** Move items from the internal trash to the operating system trash, after confirmation. */
export async function emptyTrash(ids?: number[]): Promise<void> {
  const state = await api<{ counts: { trash: number } }>('/api/state')
  const n = ids?.length ?? state.counts.trash
  if (!n) return
  const what = n > 1 ? `ces ${n.toLocaleString('fr-FR')} éléments` : 'cet élément'
  const trashName = window.desktop?.platform === 'win32' ? 'la Corbeille de Windows' : 'la Corbeille du Mac'
  const ok = await confirm({
    title: 'Supprimer définitivement ?',
    message: `Les fichiers de ${what} seront déplacés dans ${trashName}. Vous pourrez encore les y récupérer tant qu’elle n’est pas vidée.`,
    confirmLabel: 'Supprimer',
    danger: true
  })
  if (!ok) return
  const r = await api<{ removed: number; failed: number }>('/api/trash/empty', { method: 'POST', json: { ids } })
  useUi.getState().toast(
    r.failed ? `${r.removed} supprimé(s), ${r.failed} impossible(s) à déplacer` : `${r.removed.toLocaleString('fr-FR')} élément${r.removed > 1 ? 's' : ''} déplacé${r.removed > 1 ? 's' : ''} dans la corbeille du système`
  )
}
