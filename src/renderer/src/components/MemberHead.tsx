// Household members are objects (design/DIRECTION-ARTISTIQUE.md, rule 6): a silhouette whose head is the
// object the member chose. Product-owned copy of the house's vector sketch (Passage, dessins.tsx), standing in
// for the real illustrations. Colours are named product values in styles.css (--head-*, --figure-*).
import type { CSSProperties } from 'react'
import { t } from '@/i18n'

/** The heads the house has drawn so far. A profile may carry another one: it gets a plain head. */
export const MEMBER_OBJECTS = ['fleur', 'lampe', 'theiere', 'pavillon', 'globe'] as const

export const objectLabel = (objet: string): string =>
  objet === 'fleur' ? t('la fleur') : objet === 'lampe' ? t('la lampe') : objet === 'theiere' ? t('la théière') : objet === 'pavillon' ? t('le pavillon') : objet === 'globe' ? t('le globe') : objet

const fill = (v: string): CSSProperties => ({ fill: `var(${v})` })
const line = (v: string): CSSProperties => ({ stroke: `var(${v})` })

function Head({ objet }: { objet: string }) {
  switch (objet) {
    case 'fleur':
      return (
        <g>
          {Array.from({ length: 12 }, (_, i) => (
            <ellipse key={i} cx="60" cy="30" rx="8" ry="17" style={{ ...fill('--head-fleur'), ...line('--head-fleur-line') }} strokeWidth="1" transform={`rotate(${i * 30} 60 46)`} />
          ))}
          <circle cx="60" cy="46" r="9" style={fill('--head-fleur-heart')} />
        </g>
      )
    case 'lampe':
      return (
        <g>
          <path d="M36 60 L84 60 L74 18 L46 18 Z" style={{ ...fill('--head-lampe'), ...line('--head-lampe-line') }} strokeWidth="1.5" />
          <rect x="56" y="60" width="8" height="8" style={fill('--head-lampe-foot')} />
        </g>
      )
    case 'theiere':
      return (
        <g>
          <ellipse cx="60" cy="48" rx="24" ry="18" style={{ ...fill('--head-theiere'), ...line('--head-theiere-line') }} strokeWidth="1.5" />
          <path d="M84 44 C96 36 98 28 100 24" fill="none" style={line('--head-theiere-line')} strokeWidth="5" strokeLinecap="round" />
          <path d="M36 40 C22 40 22 58 38 56" fill="none" style={line('--head-theiere-line')} strokeWidth="4" />
          <rect x="52" y="26" width="16" height="6" rx="3" style={fill('--head-theiere-lid')} />
        </g>
      )
    case 'pavillon':
      return (
        <g>
          <path d="M58 66 L54 40 C40 30 34 14 40 6 C56 12 78 10 92 2 C94 16 82 32 66 40 L62 66 Z" style={{ ...fill('--head-pavillon'), ...line('--head-pavillon-line') }} strokeWidth="1.5" />
          <ellipse cx="66" cy="6" rx="27" ry="6" style={fill('--head-pavillon-mouth')} transform="rotate(-10 66 6)" />
        </g>
      )
    case 'globe':
      return (
        <g>
          <circle cx="60" cy="40" r="24" style={{ ...fill('--head-globe'), ...line('--head-globe-line') }} strokeWidth="1.5" />
          <path d="M44 32 C50 28 56 36 62 32 C68 28 72 36 78 33" fill="none" style={line('--head-globe-land')} strokeWidth="4" strokeLinecap="round" />
          <ellipse cx="60" cy="40" rx="10" ry="24" fill="none" stroke="rgba(255,255,255,0.45)" strokeWidth="1.2" />
        </g>
      )
    default:
      return <circle cx="60" cy="40" r="22" style={fill('--head-unknown')} />
  }
}

/** The whole figure, for « qui est là ? ». Stand it on <Ombre /> (Brume, rule 4). */
export function Silhouette({ objet, height }: { objet: string; height: number }) {
  const shirt = fill('--figure-shirt')
  const trousers = fill('--figure-trousers')
  return (
    <svg width={Math.round((height * 120) / 220)} height={height} viewBox="0 0 120 220" aria-hidden="true">
      <rect x="45" y="142" width="13" height="66" rx="6" style={trousers} />
      <rect x="62" y="142" width="13" height="66" rx="6" style={trousers} />
      <ellipse cx="49" cy="210" rx="10" ry="5" style={trousers} />
      <ellipse cx="71" cy="210" rx="10" ry="5" style={trousers} />
      <rect x="28" y="84" width="11" height="56" rx="5.5" style={shirt} />
      <rect x="81" y="84" width="11" height="56" rx="5.5" style={shirt} />
      <rect x="36" y="76" width="48" height="74" rx="15" style={shirt} />
      <rect x="55" y="64" width="10" height="16" style={fill('--figure-skin')} />
      <Head objet={objet} />
    </svg>
  )
}

/** The member's avatar: their object head in a round. `background` defaults to the surface colour. */
export function MemberAvatar({ objet, size, background = 'var(--dh-surface)', title }: { objet: string; size: number; background?: string; title?: string }) {
  return (
    <span
      role={title ? 'img' : undefined}
      aria-label={title}
      aria-hidden={title ? undefined : true}
      title={title}
      className="inline-flex shrink-0 items-center justify-center overflow-hidden rounded-full"
      style={{ width: size, height: size, background }}
    >
      <svg width={size} height={size} viewBox="20 0 80 80" aria-hidden="true">
        <Head objet={objet} />
      </svg>
    </span>
  )
}
