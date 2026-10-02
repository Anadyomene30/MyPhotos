import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import * as maplibregl from 'maplibre-gl'
import mapWorkerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?worker&url'
import { apiBase, token } from '@/api/client'
import type { Feature, FeatureCollection, Point } from 'geojson'
import 'maplibre-gl/dist/maplibre-gl.css'
import { Loader2 } from 'lucide-react'
import { api, media } from '@/api/client'
import { openAsset, usePlaces } from '@/api/hooks'
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

const ID_BASE = 1e10

/** Last map view, so coming back from a photo shows the same place. */
let lastView: { center: [number, number]; zoom: number } | null = null

/** Rounded photo thumbnail used as a map marker; clusters carry a count badge. */
function photoMarker(id: number, v: string, count: number | null, label: string): HTMLButtonElement {
  const el = document.createElement('button')
  el.className = count ? 'map-photo map-photo-cluster' : 'map-photo'
  el.setAttribute('aria-label', label)
  const img = document.createElement('img')
  img.src = media.thumb(id, v)
  img.alt = ''
  img.draggable = false
  img.decoding = 'async'
  el.appendChild(img)
  if (count) {
    const badge = document.createElement('span')
    badge.textContent = count >= 1000 ? `${Math.floor(count / 1000)}k` : String(count)
    el.appendChild(badge)
  }
  return el
}

/** Map of every geotagged item (clustered) plus the list of places, both filtering the library. */
export function PlacesPage() {
  const { data: places, isLoading } = usePlaces()
  const openPlace = useUi((s) => s.openPlace)
  const mapEl = useRef<HTMLDivElement>(null)
  const map = useRef<maplibregl.Map | null>(null)
  const [ready, setReady] = useState(false)
  const win = window.desktop && window.desktop.platform !== 'darwin'
  const dark = document.documentElement.classList.contains('dark')

  useEffect(() => {
    if (!mapEl.current || map.current) return
    const m = new maplibregl.Map({ container: mapEl.current, style: STYLE, center: [2.5, 46.5], zoom: 4, maxZoom: 19, attributionControl: { compact: true } })
    m.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right')
    map.current = m
    m.on('load', async () => {
      const geojson = await api<FeatureCollection>('/api/places/points')
      // thumbnail version per id, to build the URL of a cluster's cover
      const versions = new Map<number, string>()
      for (const f of geojson.features) versions.set(f.properties!.id as number, String(f.properties!.v ?? ''))
      m.addSource('photos', { type: 'geojson', data: geojson, cluster: true, clusterRadius: 56, clusterMaxZoom: 19, maxzoom: 20, clusterProperties: { rank: ['max', ['get', 'rank']] } })
      // invisible layer: keeps the source's tiles loaded so markers can be read from it
      m.addLayer({ id: 'photos-hit', type: 'circle', source: 'photos', paint: { 'circle-radius': 1, 'circle-opacity': 0 } })
      if (lastView) m.jumpTo(lastView)
      else if (geojson.features.length) {
        const b = new maplibregl.LngLatBounds()
        for (const f of geojson.features) b.extend((f.geometry as Point).coordinates as [number, number])
        m.fitBounds(b, { padding: 60, maxZoom: 11, duration: 0 })
      }

      // closing the photo comes back to the map
      const openPhoto = (id: number): void => void openAsset(id, () => useUi.getState().openPage('places'))
      const src = m.getSource('photos') as maplibregl.GeoJSONSource
      let shown = new Map<string, maplibregl.Marker>()
      const sync = (): void => {
        if (!m.isSourceLoaded('photos')) return
        const next = new Map<string, maplibregl.Marker>()
        for (const f of m.querySourceFeatures('photos')) {
          const p = f.properties as Record<string, number>
          const cluster = Boolean(p.cluster)
          const key = cluster ? `c${p.cluster_id}:${p.point_count}` : `p${p.id}`
          if (next.has(key)) continue
          let mk = shown.get(key)
          if (!mk) {
            const id = cluster ? Math.round(p.rank! % ID_BASE) : p.id!
            const n = cluster ? p.point_count! : null
            const el = photoMarker(id, versions.get(id) ?? '', n, n ? tn(n, '{n} élément', '{n} éléments') : t('Ouvrir la photo'))
            const at = (f.geometry as Point).coordinates as [number, number]
            el.addEventListener('click', (e) => {
              e.stopPropagation()
              if (!cluster) return openPhoto(id)
              // frame the real photos: a cluster's own position is rounded to the tile it was read from
              void src.getClusterLeaves(p.cluster_id!, Infinity, 0).then((leaves) => {
                const b = new maplibregl.LngLatBounds()
                for (const l of leaves) b.extend((l.geometry as Point).coordinates as [number, number])
                const sw = b.getSouthWest()
                const ne = b.getNorthEast()
                // all taken at the same spot: zooming cannot separate them, open the best one
                if (Math.abs(ne.lng - sw.lng) < 1e-5 && Math.abs(ne.lat - sw.lat) < 1e-5) return openPhoto(id)
                m.fitBounds(b, { padding: 90, maxZoom: 19 })
              })
            })
            mk = new maplibregl.Marker({ element: el }).setLngLat(at).addTo(m)
          }
          next.set(key, mk)
        }
        for (const [k, mk] of shown) if (!next.has(k)) mk.remove()
        shown = next
      }
      m.on('render', sync)
      m.on('moveend', () => {
        const c = m.getCenter()
        lastView = { center: [c.lng, c.lat], zoom: m.getZoom() }
      })
      setReady(true)
    })
    return () => {
      m.remove()
      map.current = null
    }
  }, [])

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
        <h1 className="etiquette">{t('Lieux')}</h1>
        <span className="text-[12px] text-muted">{places ? `${plural(places.length, 'lieu', 'lieux')} · ${tn(places.reduce((a, p) => a + p.count, 0), '{n} élément localisé', '{n} éléments localisés')}` : ''}</span>
      </header>
      <div className="flex min-h-0 flex-1">
        <aside className="scroll-thin w-[280px] shrink-0 overflow-y-auto border-r border-line py-2">
          {isLoading && <Loader2 className="mx-auto mt-6 size-5 animate-spin text-faint" />}
          {places && places.length === 0 && <p className="px-4 py-6 text-center text-[12.5px] text-muted">{t('Aucune photo avec localisation. Les photos d’iPhone et d’appareils avec GPS apparaîtront ici.')}</p>}
          {[...byCountry.entries()].map(([country, list]) => (
            <section key={country} className="mb-2">
              <h2 className="px-4 pt-2 pb-1 text-[11px] font-bold text-faint">{country}</h2>
              {list!.map((p) => (
                <button
                  key={`${p.city}|${p.cc}`}
                  onClick={() => openPlace(p.city)}
                  onMouseEnter={() => flyTo(p.lat, p.lon)}
                  className="flex w-full items-center gap-3 px-4 py-1.5 text-left hover:bg-hover"
                >
                  <div className="tile-bg size-10 shrink-0 overflow-hidden rounded-lg">{p.coverId && <img src={media.thumb(p.coverId, p.coverV)} alt="" className="h-full w-full object-cover" />}</div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{p.city}</div>
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
