import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query'
import { api, onServerEvent, qs } from './client'
import { useUi } from '@/store'
import { TileCache, queryKey } from '@/features/library/tileCache'
import type { AssetDetail, DayBucket, JobGroupState, LibraryState, TimelineQuery } from '@shared/types'

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
        if (e.type === 'library-changed') {
          bump(e.version)
          void qc.invalidateQueries({ queryKey: ['state'] })
          void qc.invalidateQueries({ queryKey: ['buckets'] })
          void qc.invalidateQueries({ queryKey: ['years'] })
          void qc.invalidateQueries({ queryKey: ['asset'] })
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
  return useMemo(() => ({ filter: section, kind }), [section, kind])
}

export function useBuckets(q: TimelineQuery) {
  return useQuery({
    queryKey: ['buckets', queryKey(q)],
    queryFn: () => api<DayBucket[]>(`/api/timeline/buckets${qs({ filter: q.filter, kind: q.kind, year: q.year })}`),
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
