// MyPhotos' object, the globe, standing on its charcoal shadow (design/DIRECTION-ARTISTIQUE.md,
// rules 4 and 5). Product-owned copy of the house's vector sketch (Passage, dessins.tsx), which
// stands in for the real illustration until the house delivers it. Colours come from the theme:
// the accent for the globe, the ink for the stand, the charcoal for the shadow.
import type { ReactElement } from 'react'

const ACCENT = { fill: 'var(--dh-accent)' }
const INK = { fill: 'var(--dh-fg)' }

/** Deterministic pseudo-random, so the shadow looks the same at every render. */
function alea(seed: number): () => number {
  let s = seed >>> 0 || 1
  return () => (s = (s * 1664525 + 1013904223) >>> 0) / 4294967296
}

/** Charcoal shadow: stippled ellipse plus short horizontal strokes. Only under a drawn object. */
export function Ombre({ width }: { width: number }) {
  const h = Math.max(20, Math.round(width / 4))
  const r = alea(width * 7 + 3)
  const strokes: ReactElement[] = []
  const n = Math.max(5, Math.floor(width / 30))
  for (let i = 0; i < n; i++) {
    const y = (0.4 + r() * 0.55) * 50
    const x1 = 4 + r() * 106
    const L = 30 + r() * 60
    const dash = ['6 3', '10 2 3 2', '4 4', '14 3'][Math.floor(r() * 4)]
    strokes.push(
      <path
        key={i}
        d={`M${x1.toFixed(0)} ${y.toFixed(1)} L${Math.min(196, x1 + L).toFixed(0)} ${(y + r() * 2 - 1).toFixed(1)}`}
        style={{ stroke: 'var(--charcoal)' }}
        strokeWidth={[1, 1.4, 1.8][Math.floor(r() * 3)]}
        strokeDasharray={dash}
        opacity={(0.45 + r() * 0.35).toFixed(2)}
      />
    )
  }
  return (
    <svg aria-hidden="true" width={width} height={h} viewBox="0 0 200 50" preserveAspectRatio="none" style={{ display: 'block', marginTop: -Math.round(h * 0.55) }}>
      <defs>
        <filter id="mp-stip" x="-5%" y="-30%" width="110%" height="160%">
          <feTurbulence type="fractalNoise" baseFrequency="1.15" numOctaves={1} seed={5} result="n" />
          <feColorMatrix in="n" type="matrix" values="0 0 0 0 0 0 0 0 0 0 0 0 0 0 0 3 0 0 0 -1" result="na" />
          <feComposite in="SourceAlpha" in2="na" operator="arithmetic" k1={0} k2={1} k3={-0.9} k4={0.25} result="m" />
          <feComponentTransfer in="m" result="t">
            <feFuncA type="discrete" tableValues="0 1" />
          </feComponentTransfer>
          <feFlood style={{ floodColor: 'var(--charcoal)' }} />
          <feComposite in2="t" operator="in" />
        </filter>
        <radialGradient id="mp-stipR">
          <stop offset="0" stopColor="black" stopOpacity={0.95} />
          <stop offset="0.55" stopColor="black" stopOpacity={0.6} />
          <stop offset="1" stopColor="black" stopOpacity={0} />
        </radialGradient>
      </defs>
      <g filter="url(#mp-stip)">
        <ellipse cx="100" cy="26" rx="98" ry="21" fill="url(#mp-stipR)" />
      </g>
      {strokes}
    </svg>
  )
}

/** The globe on its shadow, alone in the mist: the empty-state scene. */
export function GlobeScene({ size = 132 }: { size?: number }) {
  return (
    <div className="flex flex-col items-center" aria-hidden="true">
      <svg width={size} height={Math.round(size * 1.15)} viewBox="0 0 200 230">
        <circle cx="100" cy="92" r="78" style={ACCENT} />
        <ellipse cx="100" cy="92" rx="34" ry="78" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <ellipse cx="100" cy="92" rx="78" ry="26" fill="none" stroke="rgba(255,255,255,0.35)" strokeWidth="1.5" />
        <path d="M58 62 C72 54 84 70 98 62 C110 56 118 74 132 66" fill="none" stroke="rgba(255,255,255,0.55)" strokeWidth="5" strokeLinecap="round" />
        <path d="M66 116 C80 124 94 108 112 118" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="5" strokeLinecap="round" />
        <path d="M28 92 A72 72 0 0 0 172 92" fill="none" style={{ stroke: 'var(--dh-fg)' }} strokeWidth="3" />
        <rect x="97" y="170" width="6" height="40" style={INK} />
        <rect x="72" y="208" width="56" height="8" rx="4" style={INK} />
      </svg>
      <Ombre width={Math.round(size * 1.15)} />
    </div>
  )
}
