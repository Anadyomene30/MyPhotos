import { create } from 'zustand'
import type { KindFilter, LibraryFilter } from '@shared/types'

export type Grouping = 'year' | 'month' | 'day'
export type Theme = 'system' | 'light' | 'dark'

/** target cell sizes in CSS px */
export const ZOOM_LEVELS = [44, 64, 88, 120, 160, 210, 280, 380] as const
export const DEFAULT_ZOOM: Record<Grouping, number> = { year: 0, month: 2, day: 4 }

export interface Toast {
  id: number
  message: string
  action?: { label: string; run: () => void }
}

interface UiState {
  section: LibraryFilter
  /** active album, shown with the library filters applied inside it */
  albumId: number | null
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
  section: 'all',
  albumId: null,
  smartEditor: null,
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
  setSection: (section) => set({ section, albumId: null, selection: new Set(), anchor: null, viewerIndex: null }),
  openAlbum: (albumId) => set({ section: 'all', albumId, selection: new Set(), anchor: null, viewerIndex: null }),
  setSmartEditor: (smartEditor) => set({ smartEditor }),
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
