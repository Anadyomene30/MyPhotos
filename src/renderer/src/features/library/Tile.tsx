import { memo, useState } from 'react'
import { Heart, Layers, Play, SlidersHorizontal } from 'lucide-react'
import clsx from 'clsx'
import { media } from '@/api/client'
import { duration } from '@/lib/format'
import type { AssetTile } from '@shared/types'

function LiveIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth={1.8}>
      <circle cx="12" cy="12" r="3.2" />
      <circle cx="12" cy="12" r="6.4" strokeDasharray="0.1 0" />
      <circle cx="12" cy="12" r="9.6" strokeDasharray="1.6 2.2" />
    </svg>
  )
}

export const Tile = memo(function Tile({ tile, index, size, selected, compact }: {
  tile: AssetTile | undefined
  index: number
  size: number
  selected: boolean
  compact: boolean
}) {
  const [loaded, setLoaded] = useState(false)
  return (
    <div
      data-index={index}
      data-id={tile?.id}
      draggable={Boolean(tile)}
      className={clsx('tile-bg group relative overflow-hidden', !compact && 'rounded-[3px]')}
      style={{ width: size, height: size }}
    >
      {tile && (
        <img
          key={`${tile.id}:${tile.v}`}
          src={media.thumb(tile.id, tile.v)}
          alt=""
          draggable={false}
          decoding="async"
          onLoad={() => setLoaded(true)}
          className={clsx('thumb pointer-events-none h-full w-full object-cover', loaded && 'loaded')}
        />
      )}
      {tile && !compact && (
        <>
          {(tile.kind === 'video' || tile.live || tile.favorite || tile.edited || tile.versions > 0) && (
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-9 bg-gradient-to-t from-black/45 to-transparent" />
          )}
          {tile.live && <LiveIcon className="pointer-events-none absolute left-1.5 top-1.5 size-4 text-white drop-shadow" />}
          {tile.kind === 'video' && (
            <div className="pointer-events-none absolute bottom-1 right-1.5 flex items-center gap-1 text-[11px] font-semibold text-white drop-shadow">
              <Play className="size-3 fill-white" />
              {duration(tile.duration)}
            </div>
          )}
          {tile.kind === 'photo' && (tile.edited || tile.versions > 0) && (
            <div className="pointer-events-none absolute right-1.5 bottom-1.5 flex items-center gap-1 text-white drop-shadow">
              {tile.edited && <SlidersHorizontal className="size-3.5" />}
              {tile.versions > 0 && <Layers className="size-3.5" />}
            </div>
          )}
          {tile.favorite && <Heart className="pointer-events-none absolute bottom-1.5 left-1.5 size-3.5 fill-white text-white drop-shadow" />}
        </>
      )}
      {selected && (
        <>
          <div className="pointer-events-none absolute inset-0 bg-accent/20 ring-[3px] ring-accent ring-inset" />
          <div className="pointer-events-none absolute right-1.5 top-1.5 grid size-5 place-items-center rounded-full bg-accent text-white shadow ring-2 ring-white">
            <svg viewBox="0 0 16 16" className="size-3" fill="none" stroke="currentColor" strokeWidth={2.4}>
              <path d="M3.5 8.5l3 3 6-7" />
            </svg>
          </div>
        </>
      )}
    </div>
  )
})
