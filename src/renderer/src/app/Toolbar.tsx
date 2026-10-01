import { t, tn } from '@/i18n'
import clsx from 'clsx'
import { useRef, useState } from 'react'
import { Clapperboard, FolderMinus, Share, Heart, Users, Wand2, MoreHorizontal, Minus, Pencil, Plus, RotateCcw, Sparkles, Trash2, X } from 'lucide-react'
import { IconButton, Segmented } from '@/components/ui'
import { albumsApi, patchAssets, useAlbums, useCategories, useLibraryState, usePersons } from '@/api/hooks'
import { SearchBar } from './SearchBar'
import { PersonAvatar } from '@/features/people/PeoplePage'
import { AddToAlbumButton } from '@/features/albums/AddToAlbumMenu'
import { startFusion } from '@/features/cleanup/BracketList'
import { MenuItem, MenuSeparator, Popover } from '@/components/Popover'
import { promptText } from '@/components/Prompt'
import { confirm } from '@/components/Confirm'
import { api } from '@/api/client'
import { useUi, ZOOM_LEVELS, type Grouping } from '@/store'
import { useScrollLabel } from '@/features/library/scrollLabel'
import { trashWithUndo } from '@/features/library/Timeline'
import { count, plural } from '@/lib/format'
import { Button } from '@/components/ui'
import { emptyTrash } from '@/features/library/trash'
import type { KindFilter, LibraryFilter } from '@shared/types'

const TITLES: Record<LibraryFilter, string> = {
  all: t('Photothèque'), photos: t('Photos'), videos: t('Vidéos'), live: 'Live Photos',
  screenshots: t('Captures d’écran'), favorites: t('Favoris'), raw: 'RAW', trash: t('Corbeille')
}

export function Toolbar() {
  const section = useUi((s) => s.section)
  const kind = useUi((s) => s.kind)
  const grouping = useUi((s) => s.grouping)
  const zoom = useUi((s) => s.zoom)
  const selection = useUi((s) => s.selection)
  const { setKind, setGrouping, setZoom, clearSelection } = useUi.getState()
  const label = useScrollLabel((s) => s.label)
  const { data } = useLibraryState()
  const albumId = useUi((s) => s.albumId)
  const { data: albums } = useAlbums()
  const album = albumId !== null ? albums?.find((a) => a.id === albumId) : undefined
  const personId = useUi((s) => s.personId)
  const category = useUi((s) => s.category)
  const place = useUi((s) => s.place)
  const search = useUi((s) => s.search)
  const similarTo = useUi((s) => s.similarTo)
  const { data: persons } = usePersons(true)
  const { data: cats } = useCategories()
  const person = personId !== null ? persons?.find((p) => p.id === personId) : undefined
  const context: { title: string; icon?: React.ReactNode } | null =
    personId !== null ? { title: person?.name ?? t('Personne sans nom'), icon: person ? <PersonAvatar person={person} size={22} /> : undefined }
    : category ? { title: cats?.find((c) => c.id === category)?.label ?? category }
    : place ? { title: place }
    : similarTo !== null ? { title: t('Photos semblables') }
    : search.trim() ? { title: `« ${search.trim()} »` }
    : null
  const win = window.desktop && window.desktop.platform !== 'darwin'
  const n = selection.size
  const counts = data?.counts

  const subtitle = (() => {
    if (!counts) return ''
    if (album) return plural(album.count, 'élément', 'éléments')
    if (context) return ''
    if (section === 'all') {
      if (kind === 'photo') return plural(counts.photos, 'photo', 'photos')
      if (kind === 'video') return plural(counts.videos, 'vidéo', 'vidéos')
      return `${plural(counts.photos, 'photo', 'photos')} · ${plural(counts.videos, 'vidéo', 'vidéos')}`
    }
    const c = counts[section as keyof typeof counts]
    return typeof c === 'number' ? plural(c, 'élément', 'éléments') : ''
  })()

  return (
    <header
      className={clsx(
        'drag absolute inset-x-0 top-0 z-20 flex h-[52px] items-center gap-3 border-b border-line bg-bg/80 pl-5 backdrop-blur-2xl backdrop-saturate-150',
        win ? 'pr-[150px]' : 'pr-4'
      )}
    >
      <div className="min-w-0 flex-1">
        {n > 0 ? (
          <div className="no-drag flex items-center gap-2">
            <button onClick={clearSelection} className="grid size-6 place-items-center rounded-full bg-hover text-muted hover:text-fg" aria-label={t('Désélectionner')}>
              <X className="size-3.5" />
            </button>
            <span className="text-[14px] font-semibold">{tn(n, '{n} sélectionné', '{n} sélectionnés')}</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2.5 truncate">
            {context && !label ? (
              <div className="no-drag flex items-center gap-2">
                {context.icon}
                <h1 className="font-display text-[15px] font-semibold tracking-tight">{context.title}</h1>
                {personId !== null && (
                  <button onClick={() => useUi.getState().openRetro({ source: { type: 'person', value: personId }, title: person?.name ?? undefined })} className="grid size-6 place-items-center rounded-full text-muted hover:bg-hover hover:text-fg" aria-label={t('Créer une vidéo souvenir')} title={t('Créer une vidéo souvenir')}>
                    <Clapperboard className="size-3.5" />
                  </button>
                )}
                <button onClick={() => useUi.getState().setSection('all')} className="grid size-5 place-items-center rounded-full bg-hover text-muted hover:text-fg" aria-label={t('Retour à la photothèque')} title={t('Retour à la photothèque')}>
                  <X className="size-3" />
                </button>
              </div>
            ) : (
              <>
                <h1 className="font-display text-[15px] font-semibold tracking-tight">{label ?? album?.name ?? TITLES[section]}</h1>
                <span className="truncate text-[12px] text-muted">{label ? (context?.title ?? album?.name ?? TITLES[section]) : subtitle}</span>
              </>
            )}
            {album && !label && <AlbumMenu albumId={album.id} name={album.name} smart={album.kind === 'smart'} />}
          </div>
        )}
      </div>

      {n > 0 && (
        <div className="flex items-center gap-1">
          {section === 'trash' ? (
            <>
              <IconButton label={t('Restaurer')} onClick={() => void trashWithUndo([...selection], true).then(clearSelection)}>
                <RotateCcw className="size-[17px]" />
              </IconButton>
              {window.desktop && (
                <IconButton label={t('Supprimer définitivement')} onClick={() => void emptyTrash([...selection]).then(clearSelection)}>
                  <Trash2 className="size-[17px] text-red-500" />
                </IconButton>
              )}
            </>
          ) : (
            <>
              <IconButton label={t('Exporter (⌘E)')} onClick={() => useUi.getState().setExportIds([...selection])}>
                <Share className="size-[17px]" />
              </IconButton>
              <AddToAlbumButton ids={[...selection]} />
              {n >= 4 && (
                <IconButton label={t('Créer une vidéo avec la sélection')} onClick={() => useUi.getState().openRetro({ source: { type: 'ids', value: [...selection].slice(0, 5000) } })}>
                  <Clapperboard className="size-[17px]" />
                </IconButton>
              )}
              {n >= 2 && n <= 15 && (
                <IconButton label={t('Fusionner les expositions (HDR)')} onClick={() => void startFusion([...selection]).then(() => useUi.getState().toast(t('Fusion en cours…')), (e: Error) => useUi.getState().toast(e.message))}>
                  <Wand2 className="size-[17px]" />
                </IconButton>
              )}
              {album?.kind === 'manual' && (
                <IconButton
                  label={t('Retirer de l’album')}
                  onClick={() => {
                    const ids = [...selection]
                    void albumsApi.removeAssets(album.id, ids).then(() => {
                      clearSelection()
                      useUi.getState().toast(tn(ids.length, '{n} élément retiré de « {name} »', '{n} éléments retirés de « {name} »', { name: album.name }), {
                        label: t('Annuler'),
                        run: () => void albumsApi.add(album.id, ids)
                      })
                    })
                  }}
                >
                  <FolderMinus className="size-[17px]" />
                </IconButton>
              )}
              <IconButton label={t('Ajouter aux favoris (.)')} onClick={() => void patchAssets([...selection], { favorite: true })}>
                <Heart className="size-[17px]" />
              </IconButton>
              <IconButton label={t('Supprimer (⌫)')} onClick={() => void trashWithUndo([...selection], false).then(clearSelection)}>
                <Trash2 className="size-[17px]" />
              </IconButton>
            </>
          )}
          <div className="mx-1 h-5 w-px bg-line" />
        </div>
      )}

      {n === 0 && section === 'trash' && window.desktop && (counts?.trash ?? 0) > 0 && (
        <Button variant="danger" className="py-1 text-[12.5px]" onClick={() => void emptyTrash()}>
          {t('Vider la corbeille')}
        </Button>
      )}

      <SearchBar />

      <Segmented<Grouping>
        value={grouping}
        onChange={setGrouping}
        options={[
          { value: 'year', label: t('Années'), title: t('Années (1)') },
          { value: 'month', label: t('Mois'), title: t('Mois (2)') },
          { value: 'day', label: t('Jours'), title: t('Jours (3)') },
          { value: 'moments', label: t('Moments'), title: t('Moments (4)') }
        ]}
      />

      {section !== 'live' && (
        <Segmented<KindFilter>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: t('Tout') },
            { value: 'photo', label: t('Photos') },
            { value: 'video', label: t('Vidéos') }
          ]}
        />
      )}

      <div className="no-drag flex items-center gap-1">
        <IconButton label={t('Dézoomer (−)')} onClick={() => setZoom(zoom - 1)} disabled={zoom === 0} className="size-7">
          <Minus className="size-3.5" />
        </IconButton>
        <input
          type="range"
          min={0}
          max={ZOOM_LEVELS.length - 1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1 w-20 cursor-pointer accent-[var(--accent)]"
          aria-label={t('Taille des vignettes')}
        />
        <IconButton label={t('Zoomer (+)')} onClick={() => setZoom(zoom + 1)} disabled={zoom === ZOOM_LEVELS.length - 1} className="size-7">
          <Plus className="size-3.5" />
        </IconButton>
      </div>
    </header>
  )
}

function AlbumMenu({ albumId, name, smart }: { albumId: number; name: string; smart: boolean }) {
  const ref = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  const close = (): void => setOpen(false)
  return (
    <>
      <IconButton ref={ref} label={t('Options de l’album')} className="size-6 self-center" onClick={() => setOpen((o) => !o)} active={open}>
        <MoreHorizontal className="size-4" />
      </IconButton>
      <Popover anchor={ref.current} open={open} onClose={close} align="start" width={230}>
        <MenuItem
          icon={<Pencil className="size-4" />}
          onClick={() => {
            close()
            void promptText({ title: t('Renommer l’album'), initial: name, confirmLabel: t('Renommer') }).then((n) => (n ? albumsApi.update(albumId, { name: n }) : null))
          }}
        >
          {t('Renommer…')}
        </MenuItem>
        {smart && (
          <MenuItem
            icon={<Sparkles className="size-4" />}
            onClick={() => {
              close()
              useUi.getState().setSmartEditor({ albumId })
            }}
          >
            {t('Modifier les règles…')}
          </MenuItem>
        )}
        <MenuItem
          icon={<Users className="size-4" />}
          onClick={() => {
            close()
            useUi.getState().openShare(albumId)
          }}
        >
          {t('Partager avec la famille…')}
        </MenuItem>
        <MenuItem
          icon={<Clapperboard className="size-4" />}
          onClick={() => {
            close()
            useUi.getState().openRetro({ source: { type: 'album', value: albumId }, title: name })
          }}
        >
          {t('Créer une vidéo souvenir…')}
        </MenuItem>
        <MenuItem
          icon={<Share className="size-4" />}
          onClick={() => {
            close()
            void api<number[]>(`/api/timeline/ids?album=${albumId}`).then((ids) => ids.length && useUi.getState().setExportIds(ids))
          }}
        >
          {t('Exporter l’album…')}
        </MenuItem>
        <MenuSeparator />
        <MenuItem
          danger
          icon={<Trash2 className="size-4 text-red-500" />}
          onClick={() => {
            close()
            void confirm({
              title: t('Supprimer l’album « {name} » ?', { name }),
              message: t('Seul l’album est supprimé. Les photos et vidéos restent dans votre photothèque.'),
              confirmLabel: t('Supprimer l’album'),
              danger: true
            }).then((ok) => {
              if (!ok) return
              void albumsApi.remove(albumId).then(() => useUi.getState().setSection('all'))
            })
          }}
        >
          {t('Supprimer l’album…')}
        </MenuItem>
      </Popover>
    </>
  )
}
