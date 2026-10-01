import { t } from '@/i18n'
import { Camera, Heart, ImageOff, Monitor, Trash2, Video } from 'lucide-react'
import { useUi } from '@/store'

const COPY = {
  all: { icon: ImageOff, title: t('Rien à afficher'), text: t('Les photos et vidéos de vos dossiers apparaîtront ici.') },
  photos: { icon: ImageOff, title: t('Aucune photo'), text: '' },
  videos: { icon: Video, title: t('Aucune vidéo'), text: '' },
  favorites: { icon: Heart, title: t('Aucun favori'), text: t('Sélectionnez une photo et appuyez sur « . » pour l’ajouter à vos favoris.') },
  live: { icon: Camera, title: t('Aucune Live Photo'), text: t('Les Live Photos d’iPhone (HEIC + MOV) sont détectées automatiquement.') },
  screenshots: { icon: Monitor, title: t('Aucune capture d’écran'), text: '' },
  raw: { icon: Camera, title: t('Aucun fichier RAW'), text: '' },
  trash: { icon: Trash2, title: t('La corbeille est vide'), text: t('Les éléments supprimés restent ici 30 jours. Vos fichiers ne sont jamais effacés sans confirmation.') }
} as const

export function EmptySection() {
  const section = useUi((s) => s.section)
  const kind = useUi((s) => s.kind)
  const c = COPY[section] ?? COPY.all
  const Icon = kind === 'video' && section === 'all' ? Video : c.icon
  const title = section === 'all' && kind !== 'all' ? (kind === 'video' ? t('Aucune vidéo') : t('Aucune photo')) : c.title
  return (
    <div className="grid h-full place-items-center pt-12">
      <div className="animate-fade-in flex max-w-sm flex-col items-center text-center">
        <Icon className="mb-4 size-11 text-faint" strokeWidth={1.4} />
        <h2 className="font-display text-[20px] font-semibold">{title}</h2>
        {c.text && <p className="mt-2 text-[13px] leading-relaxed text-muted">{c.text}</p>}
      </div>
    </div>
  )
}
