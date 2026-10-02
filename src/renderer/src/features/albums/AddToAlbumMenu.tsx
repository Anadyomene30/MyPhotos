import { t, tn } from '@/i18n'
import { useRef, useState } from 'react'
import { FolderPlus, Plus, SquareStack } from 'lucide-react'
import { albumsApi, useAlbums } from '@/api/hooks'
import { IconButton } from '@/components/ui'
import { MenuItem, MenuSeparator, Popover } from '@/components/Popover'
import { media } from '@/api/client'
import { useUi } from '@/store'
import { promptText } from '@/components/Prompt'

export async function addToAlbumWithToast(albumId: number, albumName: string, ids: number[]): Promise<void> {
  const r = await albumsApi.add(albumId, ids)
  const n = r.added
  useUi.getState().toast(n ? tn(n, '{n} élément ajouté à « {name} »', '{n} éléments ajoutés à « {name} »', { name: albumName }) : t('Déjà dans « {name} »', { name: albumName }))
}

export async function createAlbumFromSelection(ids: number[]): Promise<void> {
  const name = await promptText({ title: t('Nouvel album'), placeholder: t('Nom de l’album'), confirmLabel: t('Créer') })
  if (!name) return
  const a = await albumsApi.create(name, { assetIds: ids })
  useUi.getState().toast(tn(a.count, 'Album « {name} » créé avec {n} élément', 'Album « {name} » créé avec {n} éléments', { name: a.name }))
}

export function AddToAlbumButton({ ids }: { ids: number[] }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const { data: albums } = useAlbums()
  const manual = (albums ?? []).filter((a) => a.kind === 'manual')
  return (
    <>
      <IconButton ref={ref} label={t('Ajouter à un album')} onClick={() => setOpen((o) => !o)} active={open}>
        <SquareStack className="size-[17px]" />
      </IconButton>
      <Popover anchor={ref.current} open={open} onClose={() => setOpen(false)}>
        <div className="px-2.5 pt-1.5 pb-1 text-[11px] font-bold text-faint">{t('Ajouter à un album')}</div>
        <div className="scroll-thin max-h-72 overflow-y-auto">
          {manual.map((a) => (
            <MenuItem
              key={a.id}
              onClick={() => {
                setOpen(false)
                void addToAlbumWithToast(a.id, a.name, ids)
              }}
              icon={a.coverId ? <img src={media.thumb(a.coverId, a.coverV)} alt="" className="size-6 rounded object-cover" /> : <FolderPlus className="size-4" />}
            >
              {a.name}
            </MenuItem>
          ))}
        </div>
        {manual.length > 0 && <MenuSeparator />}
        <MenuItem
          icon={<Plus className="size-4" />}
          onClick={() => {
            setOpen(false)
            void createAlbumFromSelection(ids)
          }}
        >
          {t('Nouvel album avec la sélection…')}
        </MenuItem>
      </Popover>
    </>
  )
}
