import { useRef, useState } from 'react'
import clsx from 'clsx'
import { FolderHeart, Plus, Sparkles } from 'lucide-react'
import { media } from '@/api/client'
import { albumsApi, useAlbums } from '@/api/hooks'
import { MenuItem, Popover } from '@/components/Popover'
import { promptText } from '@/components/Prompt'
import { useUi } from '@/store'
import { count } from '@/lib/format'
import { DRAG_MIME, readDraggedIds } from './drag'
import { addToAlbumWithToast } from './AddToAlbumMenu'

export function SidebarAlbums() {
  const { data: albums } = useAlbums()
  const albumId = useUi((s) => s.albumId)
  const openAlbum = useUi((s) => s.openAlbum)
  const setSmartEditor = useUi((s) => s.setSmartEditor)
  const [dropTarget, setDropTarget] = useState<number | null>(null)
  const [menu, setMenu] = useState(false)
  const plus = useRef<HTMLButtonElement>(null)

  const newAlbum = async (): Promise<void> => {
    setMenu(false)
    const name = await promptText({ title: 'Nouvel album', placeholder: 'Nom de l’album', confirmLabel: 'Créer' })
    if (!name) return
    const a = await albumsApi.create(name)
    openAlbum(a.id)
  }

  return (
    <div>
      <div className="group/h flex items-center justify-between pr-1 pl-2.5 pb-1">
        <span className="text-[11px] font-semibold text-faint">Albums</span>
        <button
          ref={plus}
          onClick={() => setMenu((m) => !m)}
          className="no-drag grid size-5 place-items-center rounded-md text-faint opacity-0 transition-opacity group-hover/h:opacity-100 hover:bg-hover hover:text-fg"
          aria-label="Nouvel album"
          title="Nouvel album"
        >
          <Plus className="size-3.5" />
        </button>
        <Popover anchor={plus.current} open={menu} onClose={() => setMenu(false)} align="start" width={220}>
          <MenuItem icon={<FolderHeart className="size-4" />} onClick={() => void newAlbum()}>Nouvel album…</MenuItem>
          <MenuItem
            icon={<Sparkles className="size-4" />}
            onClick={() => {
              setMenu(false)
              setSmartEditor({ albumId: null })
            }}
          >
            Nouvel album intelligent…
          </MenuItem>
        </Popover>
      </div>
      <div className="space-y-px">
        {(albums ?? []).map((a) => {
          const active = albumId === a.id
          const droppable = a.kind === 'manual'
          return (
            <button
              key={a.id}
              onClick={() => openAlbum(a.id)}
              onDragOver={(e) => {
                if (!droppable || !e.dataTransfer.types.includes(DRAG_MIME)) return
                e.preventDefault()
                e.dataTransfer.dropEffect = 'copy'
                setDropTarget(a.id)
              }}
              onDragLeave={() => setDropTarget((t) => (t === a.id ? null : t))}
              onDrop={(e) => {
                setDropTarget(null)
                const ids = readDraggedIds(e.dataTransfer)
                if (ids?.length) void addToAlbumWithToast(a.id, a.name, ids)
              }}
              className={clsx(
                'no-drag flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2 text-left text-[13px] transition-colors',
                active ? 'bg-accent-soft font-medium' : 'text-fg/85 hover:bg-hover',
                dropTarget === a.id && 'bg-accent text-white ring-2 ring-accent'
              )}
            >
              {a.coverId ? (
                <img src={media.thumb(a.coverId, a.coverV)} alt="" className="size-[20px] shrink-0 rounded-[4px] object-cover" />
              ) : (
                <span className="grid size-[20px] shrink-0 place-items-center rounded-[4px] bg-hover">
                  {a.kind === 'smart' ? <Sparkles className="size-3 text-muted" /> : <FolderHeart className="size-3 text-muted" />}
                </span>
              )}
              <span className="flex-1 truncate">{a.name}</span>
              {a.kind === 'smart' && <Sparkles className={clsx('size-3 shrink-0', dropTarget === a.id ? 'text-white' : 'text-faint')} />}
              <span className={clsx('text-[11.5px] tabular-nums', dropTarget === a.id ? 'text-white/80' : 'text-faint')}>{count(a.count)}</span>
            </button>
          )
        })}
        {albums && albums.length === 0 && (
          <button onClick={() => void newAlbum()} className="no-drag flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[12.5px] text-faint hover:bg-hover hover:text-fg">
            <Plus className="size-[15px]" /> Créer un album
          </button>
        )}
      </div>
    </div>
  )
}
