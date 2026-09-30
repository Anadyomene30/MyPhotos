import { Camera, Calendar, FileImage, MapPin, Tag, Users } from 'lucide-react'
import { useCategories, useFaces } from '@/api/hooks'
import { useUi } from '@/store'
import { media } from '@/api/client'
import type { ReactNode } from 'react'
import { bytes, dateTime, exposure } from '@/lib/format'
import type { AssetDetail } from '@shared/types'

function Row({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-3">
      <div className="pt-0.5 text-white/45">{icon}</div>
      <div className="min-w-0 flex-1 space-y-0.5">{children}</div>
    </div>
  )
}

export function InfoPanel({ detail: d }: { detail: AssetDetail }) {
  const when = dateTime(d.takenAt, d.tzOffset)
  const mp = d.width && d.height ? ((d.width * d.height) / 1e6).toLocaleString('fr-FR', { maximumFractionDigits: 1 }) : null
  const exif = [d.fnumber ? `ƒ/${d.fnumber.toLocaleString('fr-FR')}` : null, exposure(d.exposure), d.iso ? `ISO ${d.iso}` : null, d.focal ? `${Math.round(d.focal)} mm` : null].filter(Boolean)
  const tz = d.tzOffset !== null ? `UTC${d.tzOffset >= 0 ? '+' : '−'}${String(Math.floor(Math.abs(d.tzOffset) / 60)).padStart(2, '0')}:${String(Math.abs(d.tzOffset) % 60).padStart(2, '0')}` : null
  const osm = d.lat !== null && d.lon !== null ? `https://www.openstreetmap.org/?mlat=${d.lat}&mlon=${d.lon}#map=15/${d.lat}/${d.lon}` : null
  const { data: faces } = useFaces(d.id)
  const { data: cats } = useCategories()
  const people = (faces ?? []).filter((f) => f.personId !== null)
  const labels = (d.categories ?? []).map((c) => cats?.find((x) => x.id === c)?.label ?? c)

  return (
    <aside className="animate-fade-in scroll-thin w-[320px] shrink-0 overflow-y-auto border-l border-white/10 bg-[#161618] px-5 pt-16 pb-6 text-[13px] select-text">
      <h3 className="mb-1 truncate text-[15px] font-semibold" title={d.name}>{d.name}</h3>
      <div className="divide-y divide-white/8">
        <Row icon={<Calendar className="size-4" />}>
          <div>{when.date}</div>
          <div className="text-white/55">
            {when.time}
            {tz && ` · ${tz}`}
          </div>
        </Row>
        {(d.make || d.model || exif.length > 0) && (
          <Row icon={<Camera className="size-4" />}>
            <div>{[d.make, d.model?.replace(d.make ?? '', '').trim()].filter(Boolean).join(' ') || 'Appareil inconnu'}</div>
            {d.lens && <div className="text-white/55">{d.lens}</div>}
            {exif.length > 0 && <div className="text-white/55">{exif.join('  ·  ')}</div>}
          </Row>
        )}
        <Row icon={<FileImage className="size-4" />}>
          <div>
            {d.ext.toUpperCase()}
            {d.width && d.height ? ` · ${d.width} × ${d.height}` : ''}
            {mp && d.kind === 'photo' ? ` · ${mp} Mpx` : ''}
          </div>
          <div className="text-white/55">{bytes(d.size)}</div>
          <button
            className="mt-1 block max-w-full truncate text-left text-[12px] text-sky-400 hover:underline"
            title={d.path}
            onClick={() => void window.desktop?.reveal(d.path)}
          >
            {d.path}
          </button>
        </Row>
        {people.length > 0 && (
          <Row icon={<Users className="size-4" />}>
            <div className="flex flex-wrap gap-1.5">
              {people.map((f) => (
                <button key={f.id} onClick={() => { useUi.getState().closeViewer(); useUi.getState().openPerson(f.personId!) }} className="flex items-center gap-1.5 rounded-full bg-white/10 py-0.5 pr-2.5 pl-0.5 text-[12px] hover:bg-white/20">
                  <img src={media.face(f.id)} alt="" className="size-5 rounded-full object-cover" />
                  {f.personName ?? 'Sans nom'}
                </button>
              ))}
            </div>
          </Row>
        )}
        {labels.length > 0 && (
          <Row icon={<Tag className="size-4" />}>
            <div className="flex flex-wrap gap-1.5">
              {labels.map((l, i) => (
                <button key={l} onClick={() => { useUi.getState().closeViewer(); useUi.getState().openCategory(d.categories![i]!) }} className="rounded-full bg-white/10 px-2.5 py-0.5 text-[12px] hover:bg-white/20">{l}</button>
              ))}
            </div>
          </Row>
        )}
        {osm && (
          <Row icon={<MapPin className="size-4" />}>
            {d.place && (
              <button className="block text-left hover:underline" onClick={() => { useUi.getState().closeViewer(); useUi.getState().openPlace(d.place!) }}>
                {d.place}{d.placeCountry ? `, ${d.placeCountry}` : ''}
              </button>
            )}
            <div className="text-white/55 tabular-nums">
              {d.lat!.toFixed(4)}, {d.lon!.toFixed(4)}
            </div>
            <button className="text-[12px] text-sky-400 hover:underline" onClick={() => (window.desktop ? void window.desktop.openExternal(osm) : window.open(osm, '_blank'))}>
              Ouvrir la carte
            </button>
          </Row>
        )}
      </div>
    </aside>
  )
}
