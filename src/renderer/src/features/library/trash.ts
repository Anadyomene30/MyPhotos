import { t, tn } from '@/i18n'
import { api } from '@/api/client'
import { confirm } from '@/components/Confirm'
import { useUi } from '@/store'

/** Move items from the internal trash to the operating system trash, after confirmation. */
export async function emptyTrash(ids?: number[]): Promise<void> {
  const state = await api<{ counts: { trash: number } }>('/api/state')
  const n = ids?.length ?? state.counts.trash
  if (!n) return
  const what = tn(n, 'cet élément', 'ces {n} éléments')
  const trashName = window.desktop?.platform === 'win32' ? t('la Corbeille de Windows') : t('la Corbeille du Mac')
  const ok = await confirm({
    title: t('Supprimer définitivement ?'),
    message: t('Les fichiers de {what} seront déplacés dans {trash}. Vous pourrez encore les y récupérer tant qu’elle n’est pas vidée.', { what, trash: trashName }),
    confirmLabel: t('Supprimer'),
    danger: true
  })
  if (!ok) return
  const r = await api<{ removed: number; failed: number }>('/api/trash/empty', { method: 'POST', json: { ids } })
  useUi.getState().toast(
    r.failed ? t('{removed} supprimé(s), {failed} impossible(s) à déplacer', { removed: r.removed, failed: r.failed }) : tn(r.removed, '{n} élément déplacé dans la corbeille du système', '{n} éléments déplacés dans la corbeille du système')
  )
}
