import { create } from 'zustand'
import type { KindFilter, LibraryFilter } from '@shared/types'

export type Grouping = 'year' | 'month' | 'day' | 'moments'
export type Theme = 'system' | 'light' | 'dark'

/** target cell sizes in CSS px */
export const ZOOM_LEVELS = [44, 64, 88, 120, 160, 210, 280, 380] as const
export const DEFAULT_ZOOM: Record<Grouping, number> = { year: 0, month: 2, day: 4, moments: 3 }

export interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

export type Page = 'library' | 'cleanup' | 'people' | 'places' | 'memories'

interface UiState {
  page: Page
  openPage(p: Page): void
  section: LibraryFilter
  /** active album, shown with the library filters applied inside it */
  albumId: number | null
  personId: number | null
  category: string | null
  place: string | null
  search: string
  similarTo: number | null
  openPerson(id: number): void
  openCategory(id: string): void
  openPlace(city: string): void
  setSearch(q: string): void
  openSimilar(id: number): void
  kind: KindFilter
  grouping: Grouping
  zoom: number
  selection: Set<number>
  /** global timeline index of the last clicked tile, for shift-range selection */
  anchor: number | null
  viewerIndex: number | null
  infoOpen: boolean
  settingsOpen: boolean
  theme: Theme
  version: number
  toasts: Toast[]
  setSection(s: LibraryFilter): void
  openAlbum(id: number): void
  smartEditor: { albumId: number | null } | null
  exportIds: number[] | null
  setExportIds(ids: number[] | null): void
  editorId: number | null
  setEditorId(id: number | null): void
  videoEditorId: number | null
  setVideoEditorId(id: number | null): void
  memoryId: number | null
  openMemory(id: number | null): void
  retro: { source: import('@shared/types').RetroOptions['source']; title?: string; subtitle?: string } | null
  openRetro(v: UiState['retro']): void
  setSmartEditor(v: { albumId: number | null } | null): void
  setKind(k: KindFilter): void
  setGrouping(g: Grouping): void
  setZoom(z: number): void
  select(ids: number[], mode: 'replace' | 'toggle' | 'add', anchor?: number | null): void
  clearSelection(): void
  openViewer(index: number): void
  closeViewer(): void
  toggleInfo(): void
  setSettingsOpen(open: boolean): void
  setTheme(t: Theme): void
  bumpVersion(v: number): void
  toast(message: string, action?: Toast['action']): void
  dismissToast(id: number): void
}

const saved = (() => {
  try {
    return JSON.parse(localStorage.getItem('mp-ui') ?? '{}') as Partial<Pick<UiState, 'grouping' | 'zoom' | 'theme' | 'infoOpen'>>
  } catch {
    return {}
  }
})()

let toastId = 0

export const useUi = create<UiState>((set, get) => ({
  page: 'library',
  openPage: (page) => set({ page, selection: new Set(), anchor: null, viewerIndex: null }),
  section: 'all',
  albumId: null,
  personId: null,
  category: null,
  place: null,
  search: '',
  similarTo: null,
  openPerson: (personId) => set({ page: 'library', section: 'all', albumId: null, personId, category: null, place: null, search: '', similarTo: null, selection: new Set(), anchor: null, viewerIndex: null }),
  openCategory: (category) => set({ page: 'library', section: 'all', albumId: null, personId: null, category, place: null, search: '', similarTo: null, selection: new Set(), anchor: null, viewerIndex: null }),
  openPlace: (place) => set({ page: 'library', section: 'all', albumId: null, personId: null, category: null, place, search: '', similarTo: null, selection: new Set(), anchor: null, viewerIndex: null }),
  setSearch: (search) => set({ page: 'library', search, similarTo: null, selection: new Set(), anchor: null, viewerIndex: null }),
  openSimilar: (similarTo) => set({ page: 'library', section: 'all', albumId: null, personId: null, category: null, place: null, search: '', similarTo, selection: new Set(), anchor: null, viewerIndex: null }),
  smartEditor: null,
  exportIds: null,
  editorId: null,
  videoEditorId: null,
  memoryId: null,
  openMemory: (memoryId) => set({ memoryId }),
  retro: null,
  openRetro: (retro) => set({ retro }),
  kind: 'all',
  grouping: saved.grouping ?? 'day',
  zoom: saved.zoom ?? DEFAULT_ZOOM.day,
  selection: new Set(),
  anchor: null,
  viewerIndex: null,
  infoOpen: saved.infoOpen ?? false,
  settingsOpen: false,
  theme: saved.theme ?? 'system',
  version: 0,
  toasts: [],
  setSection: (section) => set({ page: 'library', section, albumId: null, personId: null, category: null, place: null, search: '', similarTo: null, selection: new Set(), anchor: null, viewerIndex: null }),
  openAlbum: (albumId) => set({ page: 'library', section: 'all', albumId, personId: null, category: null, place: null, search: '', similarTo: null, selection: new Set(), anchor: null, viewerIndex: null }),
  setSmartEditor: (smartEditor) => set({ smartEditor }),
  setExportIds: (exportIds) => set({ exportIds }),
  setEditorId: (editorId) => set({ editorId }),
  setVideoEditorId: (videoEditorId) => set({ videoEditorId }),
  setKind: (kind) => set({ kind, selection: new Set(), anchor: null }),
  setGrouping: (grouping) => set({ grouping, zoom: DEFAULT_ZOOM[grouping] }),
  setZoom: (zoom) => set({ zoom: Math.max(0, Math.min(ZOOM_LEVELS.length - 1, zoom)) }),
  select: (ids, mode, anchor) => {
    const next = mode === 'replace' ? new Set<number>() : new Set(get().selection)
    for (const id of ids) {
      if (mode === 'toggle' && next.has(id)) next.delete(id)
      else next.add(id)
    }
    set({ selection: next, anchor: anchor === undefined ? get().anchor : anchor })
  },
  clearSelection: () => set({ selection: new Set(), anchor: null }),
  openViewer: (viewerIndex) => set({ viewerIndex }),
  closeViewer: () => set({ viewerIndex: null }),
  toggleInfo: () => set({ infoOpen: !get().infoOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setTheme: (theme) => set({ theme }),
  bumpVersion: (version) => set({ version }),
  toast: (message, action) => {
    const id = ++toastId
    set({ toasts: [...get().toasts.slice(-2), { id, message, action }] })
    setTimeout(() => get().dismissToast(id), 6000)
  },
  dismissToast: (id) => set({ toasts: get().toasts.filter((t) => t.id !== id) })
}))

useUi.subscribe((s) => {
  try {
    localStorage.setItem('mp-ui', JSON.stringify({ grouping: s.grouping, zoom: s.zoom, theme: s.theme, infoOpen: s.infoOpen }))
  } catch {
    /* storage unavailable */
  }
})
