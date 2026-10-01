import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as maplibregl from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { apiBase, token } from '@/api/client'
import type { Feature, FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2, MapPin } from 'lucide-react'
import { api, media } from '@/api/client'
import { usePlaces } from '@/api/hooks'
import { useUi } from '@/store'
import { count, plural } from '@/lib/format'
import { t, tn } from '@/i18n'

maplibregl.setWorkerUrl(mapWorkerUrl)

/** Tiles go through the backend (proper user agent, disk cache, works for LAN clients). */
const STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: [`${apiBase || location.origin}/api/tiles/{z}/{x}/{y}.png?t=${token}`],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors'
    }
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }]
}

/** Map of every geotagged item (clustered) plus the list of places, both filtering the library. */
export function PlacesPage() {
  const { data: places, isLoading } = usePlaces()
  const openPlace = useUi((s) => s.openPlace)
  const openAsset = useUi((s) => s.openViewer)
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const win = window.desktop && window.desktop.platform !== 'darwin'
  const dark = document.documentElement.classList.contains('dark')

  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = new maplibregl.Map({ container: mapEl.current, style: STYLE, center: [2.5, 46.5], zoom: 4, attributionControl: { compact: true } })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.current = m
    m.on('load', async () => {
      const geojson = await api<FeatureCollection>('/api/places/points')
      m.addSource('photos', { type: 'geojson', data: geojson, cluster: true, clusterRadius: 44, clusterMaxZoom: 15 })
      m.addLayer({ id: 'clusters', type: 'circle', source: 'photos', filter: ['has', 'point_count'], paint: { 'circle-color': '#0a84ff', 'circle-radius': ['step', ['get', 'point_count'], 16, 20, 20, 100, 26, 1000, 32], 'circle-stroke-width': 3, 'circle-stroke-color': '#fff' } })
      m.addLayer({ id: 'cluster-count', type: 'symbol', source: 'photos', filter: ['has', 'point_count'], layout: { 'text-field': ['get', 'point_count_abbreviated'], 'text-size': 12, 'text-font': ['Open Sans Bold', 'Arial Unicode MS Bold'] }, paint: { 'text-color': '#fff' } })
      m.addLayer({ id: 'points', type: 'circle', source: 'photos', filter: ['!', ['has', 'point_count']], paint: { 'circle-color': '#ff375f', 'circle-radius': 7, 'circle-stroke-width': 2, 'circle-stroke-color': '#fff' } })
      if (geojson.features.length) {
        const b = new maplibregl.LngLatBounds()
        for (const f of geojson.features) b.extend((f.geometry as Point).coordinates as [number, number])
        m.fitBounds(b, { padding: 60, maxZoom: 11, duration: 0 })
      }
      m.on('click', 'clusters', (e: maplibregl.MapMouseEvent) => {
        const f = m.queryRenderedFeatures(e.point, { layers: ['clusters'] })[0]
        if (!f) return
        const src = m.getSource('photos') as maplibregl.GeoJSONSource
        void src.getClusterExpansionZoom(f.properties!.cluster_id as number).then((z: number) => m.easeTo({ center: (f.geometry as Point).coordinates as [number, number], zoom: z }))
      })
      m.on('click', 'points', (e: maplibregl.MapMouseEvent & { features?: Feature[] }) => {
        const f = e.features?.[0]
        if (!f) return
        const id = f.properties!.id as number
        void api<{ index: number | null }>(`/api/timeline/index/${id}`).then(({ index }) => {
          if (index !== null) {
            useUi.getState().setSection('all')
            openAsset(index)
          }
        })
      })
      for (const l of ['clusters', 'points']) {
        m.on('mouseenter', l, () => (m.getCanvas().style.cursor = 'pointer'))
        m.on('mouseleave', l, () => (m.getCanvas().style.cursor = ''))
      }
      setReady(true)
    })
    return () => {
      m.remove()
      map.current = null
    }
  }, [openAsset])

  const flyTo = (lat: number, lon: number): void => {
    map.current?.flyTo({ center: [lon, lat], zoom: 11 })
  }

  const byCountry = new Map<string, typeof places>()
  for (const p of places ?? []) {
    const k = p.country ?? t('Ailleurs')
    byCountry.set(k, [...(byCountry.get(k) ?? []), p])
  }

  return (
    <div className="flex h-full flex-col">
      <header className={clsx('drag flex h-[52px] shrink-0 items-center gap-3 border-b border-line pl-5', win ? 'pr-[150px]' : 'pr-4')}>
        <MapPin className="size-[18px] text-accent" />
        <h1 className="font-display text-[15px] font-semibold tracking-tight">{t('Lieux')}</h1>
        <span className="text-[12px] text-muted">{places ? `${plural(places.length, 'lieu', 'lieux')} · ${tn(places.reduce((a, p) => a + p.count, 0), '{n} élément localisé', '{n} éléments localisés')}` : ''}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="scroll-thin w-[280px] shrink-0 overflow-y-auto border-r border-line py-2">
          {isLoading && <Loader2 className="mx-auto mt-6 size-5 animate-spin text-faint" />}
          {places && places.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-muted">{t('Aucune photo avec localisation. Les photos d’iPhone et d’appareils avec GPS apparaîtront ici.')}</p>}
          {[...byCountry.entries()].map(([country, list]) => (
            <section key={country} className="mb-2">
              <h2 className="px-4 pt-2 pb-1 text-[11px] font-semibold text-faint">{country}</h2>
              {list!.map((p) => (
                <button
                  key={`${p.city}|${p.cc}`}
                  onClick={() => openPlace(p.city)}
                  onMouseEnter={() => flyTo(p.lat, p.lon)}
                  className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-hover"
                >
                  <div className="tile-bg size-10 shrink-0 overflow-hidden rounded-lg">{p.coverId && <img src={media.thumb(p.coverId, p.coverV)} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-medium">{p.city}</div>
                    <div className="truncate text-[11.5px] text-muted">{p.admin ?? ''}</div>
                  </div>
                  <span className="text-[11.5px] text-faint tabular-nums">{count(p.count)}</span>
                </button>
              ))}
            </section>
          ))}
        </aside>
        <div className="relative min-w-0 flex-1">
          <div className={clsx('absolute inset-0', dark && 'maplibre-dark')}>
            <div ref={mapEl} className="h-full w-full" />
          </div>
          {!ready && (
            <div className="absolute inset-0 grid place-items-center bg-bg/60 text-[12.5px] text-muted">
              <span className="flex items-center gap-2"><Loader2 className="size-4 animate-spin" /> {t('Chargement de la carte (connexion internet nécessaire)')}</span>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
