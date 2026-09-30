import clsx from 'clsx'
import { Heart, Minus, Plus, RotateCcw, Trash2, X } from 'lucide-react'
import { IconButton, Segmented } from '@/components/ui'
import { patchAssets, useLibraryState } from '@/api/hooks'
import { useUi, ZOOM_LEVELS, type Grouping } from '@/store'
import { useScrollLabel } from '@/features/library/scrollLabel'
import { trashWithUndo } from '@/features/library/Timeline'
import { count, plural } from '@/lib/format'
import { Button } from '@/components/ui'
import { emptyTrash } from '@/features/library/trash'
import type { KindFilter, LibraryFilter } from '@shared/types'

const TITLES: Record<LibraryFilter, string> = {
  all: 'Photothèque', photos: 'Photos', videos: 'Vidéos', live: 'Live Photos',
  screenshots: 'Captures d’écran', favorites: 'Favoris', raw: 'RAW', trash: 'Corbeille'
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
  const win = window.desktop && window.desktop.platform !== 'darwin'
  const n = selection.size
  const counts = data?.counts

  const subtitle = (() => {
    if (!counts) return ''
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
            <button onClick={clearSelection} className="grid size-6 place-items-center rounded-full bg-hover text-muted hover:text-fg" aria-label="Désélectionner">
              <X className="size-3.5" />
            </button>
            <span className="text-[14px] font-semibold">{n > 1 ? `${count(n)} sélectionnés` : '1 sélectionné'}</span>
          </div>
        ) : (
          <div className="flex items-baseline gap-2.5 truncate">
            <h1 className="font-display text-[15px] font-semibold tracking-tight">{label ?? TITLES[section]}</h1>
            <span className="truncate text-[12px] text-muted">{label ? TITLES[section] : subtitle}</span>
          </div>
        )}
      </div>

      {n > 0 && (
        <div className="flex items-center gap-1">
          {section === 'trash' ? (
            <>
              <IconButton label="Restaurer" onClick={() => void trashWithUndo([...selection], true).then(clearSelection)}>
                <RotateCcw className="size-[17px]" />
              </IconButton>
              {window.desktop && (
                <IconButton label="Supprimer définitivement" onClick={() => void emptyTrash([...selection]).then(clearSelection)}>
                  <Trash2 className="size-[17px] text-red-500" />
                </IconButton>
              )}
            </>
          ) : (
            <>
              <IconButton label="Ajouter aux favoris (.)" onClick={() => void patchAssets([...selection], { favorite: true })}>
                <Heart className="size-[17px]" />
              </IconButton>
              <IconButton label="Supprimer (⌫)" onClick={() => void trashWithUndo([...selection], false).then(clearSelection)}>
                <Trash2 className="size-[17px]" />
              </IconButton>
            </>
          )}
          <div className="mx-1 h-5 w-px bg-line" />
        </div>
      )}

      {n === 0 && section === 'trash' && window.desktop && (counts?.trash ?? 0) > 0 && (
        <Button variant="danger" className="py-1 text-[12.5px]" onClick={() => void emptyTrash()}>
          Vider la corbeille
        </Button>
      )}

      <Segmented<Grouping>
        value={grouping}
        onChange={setGrouping}
        options={[
          { value: 'year', label: 'Années', title: 'Années (1)' },
          { value: 'month', label: 'Mois', title: 'Mois (2)' },
          { value: 'day', label: 'Jours', title: 'Jours (3)' }
        ]}
      />

      {section !== 'live' && (
        <Segmented<KindFilter>
          value={kind}
          onChange={setKind}
          options={[
            { value: 'all', label: 'Tout' },
            { value: 'photo', label: 'Photos' },
            { value: 'video', label: 'Vidéos' }
          ]}
        />
      )}

      <div className="no-drag flex items-center gap-1">
        <IconButton label="Dézoomer (−)" onClick={() => setZoom(zoom - 1)} disabled={zoom === 0} className="size-7">
          <Minus className="size-3.5" />
        </IconButton>
        <input
          type="range"
          min={0}
          max={ZOOM_LEVELS.length - 1}
          value={zoom}
          onChange={(e) => setZoom(Number(e.target.value))}
          className="h-1 w-20 cursor-pointer accent-[var(--accent)]"
          aria-label="Taille des vignettes"
        />
        <IconButton label="Zoomer (+)" onClick={() => setZoom(zoom + 1)} disabled={zoom === ZOOM_LEVELS.length - 1} className="size-7">
          <Plus className="size-3.5" />
        </IconButton>
      </div>
    </header>
  )
}
