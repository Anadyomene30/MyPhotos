import clsx from 'clsx'
import { BrushCleaning, Camera, Heart, Images, Monitor, Settings, Trash2, Aperture } from 'lucide-react'
import type { ComponentType } from 'react'
import { useLibraryState } from '@/api/hooks'
import { useUi } from '@/store'
import { count } from '@/lib/format'
import { JobsIndicator } from '@/components/JobsIndicator'
import { SidebarAlbums } from '@/features/albums/SidebarAlbums'
import type { JobGroupState, LibraryCounts, LibraryFilter } from '@shared/types'

interface Item {
  id: LibraryFilter
  label: string
  icon: ComponentType<{ className?: string; strokeWidth?: number }>
  count: keyof LibraryCounts
  hideWhenEmpty?: boolean
}

const LIBRARY: Item[] = [
  { id: 'all', label: 'Photothèque', icon: Images, count: 'all' },
  { id: 'favorites', label: 'Favoris', icon: Heart, count: 'favorites' }
]
const TYPES: Item[] = [
  { id: 'live', label: 'Live Photos', icon: Aperture, count: 'live', hideWhenEmpty: true },
  { id: 'screenshots', label: 'Captures d’écran', icon: Monitor, count: 'screenshots', hideWhenEmpty: true },
  { id: 'raw', label: 'RAW', icon: Camera, count: 'raw', hideWhenEmpty: true }
]
const OTHER: Item[] = [{ id: 'trash', label: 'Corbeille', icon: Trash2, count: 'trash' }]

export function Sidebar({ jobs, scanning }: { jobs: JobGroupState[]; scanning: boolean }) {
  const { data } = useLibraryState()
  const section = useUi((s) => s.section)
  const albumId = useUi((s) => s.albumId)
  const page = useUi((s) => s.page)
  const openPage = useUi((s) => s.openPage)
  const setSection = useUi((s) => s.setSection)
  const setSettingsOpen = useUi((s) => s.setSettingsOpen)
  const counts = data?.counts
  const mac = window.desktop?.platform === 'darwin'

  const renderItem = (it: Item) => {
    const n = counts?.[it.count] ?? 0
    if (it.hideWhenEmpty && n === 0) return null
    const Icon = it.icon
    const active = page === 'library' && section === it.id && albumId === null
    return (
      <button
        key={it.id}
        onClick={() => setSection(it.id)}
        className={clsx(
          'no-drag flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] transition-colors',
          active ? 'bg-accent-soft font-medium text-fg' : 'text-fg/85 hover:bg-hover'
        )}
      >
        <Icon className={clsx('size-[17px] shrink-0', active ? 'text-accent' : 'text-muted')} strokeWidth={1.8} />
        <span className="flex-1 truncate">{it.label}</span>
        {n > 0 && <span className="text-[11.5px] text-faint tabular-nums">{count(n)}</span>}
      </button>
    )
  }

  const types = TYPES.map(renderItem).filter(Boolean)

  return (
    <aside className="drag flex h-full w-[236px] shrink-0 flex-col border-r border-line bg-panel backdrop-blur-2xl">
      <div className={clsx('flex items-center px-4', mac ? 'h-[52px] justify-end' : 'h-[52px]')}>
        {!mac && <span className="font-display text-[15px] font-semibold tracking-tight">MyPhotos</span>}
      </div>
      <nav className="scroll-thin flex-1 space-y-5 overflow-y-auto px-2.5 pb-4">
        <Section title="Bibliothèque">{LIBRARY.map(renderItem)}</Section>
        {types.length > 0 && <Section title="Types de fichiers">{types}</Section>}
        <SidebarAlbums />
        <Section title="Autres">
          <button
            onClick={() => openPage('cleanup')}
            className={clsx(
              'no-drag flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-left text-[13px] transition-colors',
              page === 'cleanup' ? 'bg-accent-soft font-medium text-fg' : 'text-fg/85 hover:bg-hover'
            )}
          >
            <BrushCleaning className={clsx('size-[17px] shrink-0', page === 'cleanup' ? 'text-accent' : 'text-muted')} strokeWidth={1.8} />
            <span className="flex-1 truncate">Nettoyage</span>
          </button>
          {OTHER.map(renderItem)}
        </Section>
      </nav>
      <div className="no-drag space-y-2 border-t border-line p-2.5">
        <JobsIndicator jobs={jobs} scanning={scanning} />
        <button
          onClick={() => setSettingsOpen(true)}
          className="flex h-[30px] w-full items-center gap-2.5 rounded-[7px] px-2.5 text-[13px] text-fg/85 hover:bg-hover"
        >
          <Settings className="size-[17px] text-muted" strokeWidth={1.8} />
          Réglages
        </button>
      </div>
    </aside>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="px-2.5 pb-1 text-[11px] font-semibold text-faint">{title}</div>
      <div className="space-y-px">{children}</div>
    </div>
  )
}
