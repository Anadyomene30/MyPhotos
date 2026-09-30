import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onServerEvent, qs } from './client'
import { useUi } from '@/store'
import { TileCache, queryKey } from '@/features/library/tileCache'
import type { Album, AssetDetail, DayBucket, FaceInfo, JobGroupState, LibraryState, MemoryDetail, MemorySummary, MlStatus, PersonSummary, PlaceSummary, SmartRules, TimelineQuery } from '@shared/types'
import { queryParams } from '@/features/library/tileCache'

/** Wire server-sent events into react-query and the UI store. Mount once. */
export function useServerEvents(): { jobs: JobGroupState[]; scanning: boolean } {
  const qc = useQueryClient()
  const bump = useUi((s) => s.bumpVersion)
  const [jobs, setJobs] = useState<JobGroupState[]>([])
  const [scanning, setScanning] = useState(false)
  useEffect(
    () =>
      onServerEvent((e) => {
        if (e.type === 'jobs') setJobs(e.jobs)
        if (e.type === 'scan') setScanning(e.scanning)
        if (e.type === 'ml-status') qc.setQueryData(['ml-status'], e.status)
        if (e.type === 'creation-done') {
          const ui = useUi.getState()
          if (!e.ok) ui.toast(`Création impossible : ${e.error ?? 'erreur inconnue'}`)
          else
            ui.toast('Création terminée', e.assetId ? { label: 'Voir', run: () => void openAsset(e.assetId!) } : undefined)
        }
        if (e.type === 'retro-done' && !e.preview) {
          const ui = useUi.getState()
          if (!e.ok) ui.toast(`Vidéo impossible : ${e.error ?? 'erreur inconnue'}`)
          else ui.toast('Vidéo souvenir prête', e.assetId ? { label: 'Voir', run: () => void openAsset(e.assetId!) } : undefined)
        }
        if (e.type === 'export-done') {
          const r = e.result
          const ui = useUi.getState()
          const msg = r.cancelled
            ? `Export annulé (${r.exported} exporté${r.exported > 1 ? 's' : ''})`
            : r.failed
              ? `${r.exported} exporté${r.exported > 1 ? 's' : ''}, ${r.failed} en échec`
              : `${r.exported.toLocaleString('fr-FR')} élément${r.exported > 1 ? 's' : ''} exporté${r.exported > 1 ? 's' : ''}`
          if (r.errors.length) console.warn('Export errors', r.errors)
          ui.toast(msg, window.desktop ? { label: 'Afficher', run: () => void window.desktop?.reveal(r.destination) } : undefined)
        }
        if (e.type === 'library-changed') {
          bump(e.version)
          void qc.invalidateQueries({ queryKey: ['state'] })
          void qc.invalidateQueries({ queryKey: ['buckets'] })
          void qc.invalidateQueries({ queryKey: ['years'] })
          void qc.invalidateQueries({ queryKey: ['asset'] })
          void qc.invalidateQueries({ queryKey: ['albums'] })
          void qc.invalidateQueries({ queryKey: ['cleanup'] })
          void qc.invalidateQueries({ queryKey: ['persons'] })
          void qc.invalidateQueries({ queryKey: ['faces'] })
          void qc.invalidateQueries({ queryKey: ['categories'] })
          void qc.invalidateQueries({ queryKey: ['places'] })
          void qc.invalidateQueries({ queryKey: ['ml-status'] })
          void qc.invalidateQueries({ queryKey: ['memories'] })
          void qc.invalidateQueries({ queryKey: ['memory'] })
        }
      }),
    [qc, bump]
  )
  return { jobs, scanning }
}

export function useLibraryState() {
  return useQuery({ queryKey: ['state'], queryFn: () => api<LibraryState>('/api/state') })
}

export function useTimelineQuery(): TimelineQuery {
  const section = useUi((s) => s.section)
  const kind = useUi((s) => s.kind)
  const album = useUi((s) => s.albumId)
  const person = useUi((s) => s.personId)
  const category = useUi((s) => s.category)
  const place = useUi((s) => s.place)
  const search = useUi((s) => s.search)
  const similar = useUi((s) => s.similarTo)
  const grouping = useUi((s) => s.grouping)
  return useMemo(
    () => ({ filter: section, kind, album: album ?? undefined, person: person ?? undefined, category: category ?? undefined, place: place ?? undefined, search: search.trim() || undefined, similar: similar ?? undefined, group: grouping === 'moments' && !search.trim() && similar === null ? ('moments' as const) : undefined }),
    [section, kind, album, person, category, place, search, similar, grouping]
  )
}

export function useBuckets(q: TimelineQuery) {
  return useQuery({
    queryKey: ['buckets', queryKey(q)],
    queryFn: () => api<DayBucket[]>(`/api/timeline/buckets${qs(queryParams(q))}`),
    placeholderData: keepPreviousData
  })
}

export function useYears() {
  return useQuery({ queryKey: ['years'], queryFn: () => api<Array<{ year: number; count: number }>>('/api/years') })
}

export function useAsset(id: number | undefined) {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => api<AssetDetail>(`/api/assets/${id}`),
    enabled: id !== undefined,
    staleTime: 10000
  })
}

const caches = new Map<string, TileCache>()

/** One shared tile cache per timeline query, refreshed when the library version changes. */
export function useTileCache(q: TimelineQuery): TileCache {
  const key = queryKey(q)
  const cache = useMemo(() => {
    let c = caches.get(key)
    if (!c) {
      c = new TileCache(q)
      caches.set(key, c)
    }
    return c
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key])
  const version = useUi((s) => s.version)
  useEffect(() => {
    if (version > 0) cache.invalidate()
  }, [version, cache])
  useSyncExternalStore(cache.subscribe, cache.getSnapshot)
  return cache
}

export async function patchAssets(ids: number[], patch: { favorite?: boolean; trashed?: boolean }): Promise<void> {
  await api('/api/assets', { method: 'PATCH', json: { ids, ...patch } })
}

export function useAlbums() {
  return useQuery({ queryKey: ['albums'], queryFn: () => api<Album[]>('/api/albums') })
}

export const albumsApi = {
  create: (name: string, opts: { kind?: 'manual' | 'smart'; rules?: SmartRules; assetIds?: number[] } = {}) =>
    api<Album>('/api/albums', { method: 'POST', json: { name, kind: opts.kind ?? 'manual', rules: opts.rules, assetIds: opts.assetIds } }),
  update: (id: number, patch: { name?: string; rules?: SmartRules; coverId?: number | null }) => api<Album>(`/api/albums/${id}`, { method: 'PATCH', json: patch }),
  remove: (id: number) => api(`/api/albums/${id}`, { method: 'DELETE' }),
  add: (id: number, ids: number[]) => api<{ added: number }>(`/api/albums/${id}/assets`, { method: 'POST', json: { ids } }),
  removeAssets: (id: number, ids: number[]) => api<{ removed: number }>(`/api/albums/${id}/assets`, { method: 'DELETE', json: { ids } })
}

/** Show one asset in the viewer, from the whole library timeline. */
export async function openAsset(id: number): Promise<void> {
  const ui = useUi.getState()
  ui.setSection('all')
  ui.setKind('all')
  const { index } = await api<{ index: number | null }>(`/api/timeline/index/${id}`)
  if (index !== null) useUi.getState().openViewer(index)
}

export function useMlStatus() {
  return useQuery({ queryKey: ['ml-status'], queryFn: () => api<MlStatus>('/api/ml/status'), refetchInterval: (q) => (q.state.data?.download ? 1000 : false) })
}

export function usePersons(all = false) {
  return useQuery({ queryKey: ['persons', all], queryFn: () => api<PersonSummary[]>(`/api/persons${all ? '?all=1' : ''}`) })
}

export function useFaces(assetId: number | undefined) {
  return useQuery({ queryKey: ['faces', assetId], queryFn: () => api<FaceInfo[]>(`/api/assets/${assetId}/faces`), enabled: assetId !== undefined })
}

export function useCategories() {
  return useQuery({ queryKey: ['categories'], queryFn: () => api<Array<{ id: string; label: string; count: number; coverId: number }>>('/api/categories') })
}

export function usePlaces() {
  return useQuery({ queryKey: ['places'], queryFn: () => api<PlaceSummary[]>('/api/places') })
}

export const mlApi = {
  enable: (enabled: boolean) => api<MlStatus>('/api/ml/enable', { method: 'POST', json: { enabled } }),
  download: (pack: string) => api('/api/ml/download/' + pack, { method: 'POST' }),
  cancelDownload: () => api('/api/ml/download', { method: 'DELETE' }),
  renamePerson: (id: number, name: string | null) => api(`/api/persons/${id}`, { method: 'PATCH', json: { name } }),
  hidePerson: (id: number, hidden: boolean) => api(`/api/persons/${id}`, { method: 'PATCH', json: { hidden } }),
  merge: (into: number, from: number[]) => api('/api/persons/merge', { method: 'POST', json: { into, from } }),
  setCover: (personId: number, faceId: number) => api(`/api/persons/${personId}/cover`, { method: 'POST', json: { faceId } }),
  moveFace: (faceId: number, personId: number | null) => api(`/api/faces/${faceId}/move`, { method: 'POST', json: { personId } }),
  namePerson: (faceId: number, name: string) => api<{ personId: number }>(`/api/faces/${faceId}/person`, { method: 'POST', json: { name } })
}

export function useMemories() {
  return useQuery({ queryKey: ['memories'], queryFn: () => api<MemorySummary[]>('/api/memories') })
}

export function useMemory(id: number | null) {
  return useQuery({ queryKey: ['memory', id], queryFn: () => api<MemoryDetail>(`/api/memories/${id}`), enabled: id !== null })
}

export const memoriesApi = {
  update: (id: number, patch: { title?: string; subtitle?: string | null; pinned?: boolean; dismissed?: boolean; assetIds?: number[]; coverId?: number }) => api(`/api/memories/${id}`, { method: 'PATCH', json: patch }),
  saveAlbum: (id: number) => api<{ albumId: number }>(`/api/memories/${id}/album`, { method: 'POST' }),
  regenerate: (id: number) => api(`/api/memories/${id}/regenerate`, { method: 'POST' }),
  enrich: (id: number) => api<{ title: string; subtitle: string }>(`/api/memories/${id}/enrich`, { method: 'POST' })
}
