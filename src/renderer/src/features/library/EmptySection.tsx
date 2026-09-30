import { Camera, Heart, ImageOff, Monitor, Trash2, Video } from 'lucide-react'
import { useUi } from '@/store'

const COPY = {
  all: { icon: ImageOff, title: 'Rien à afficher', text: 'Les photos et vidéos de vos dossiers apparaîtront ici.' },
  photos: { icon: ImageOff, title: 'Aucune photo', text: '' },
  videos: { icon: Video, title: 'Aucune vidéo', text: '' },
  favorites: { icon: Heart, title: 'Aucun favori', text: 'Sélectionnez une photo et appuyez sur « . » pour l’ajouter à vos favoris.' },
  live: { icon: Camera, title: 'Aucune Live Photo', text: 'Les Live Photos d’iPhone (HEIC + MOV) sont détectées automatiquement.' },
  screenshots: { icon: Monitor, title: 'Aucune capture d’écran', text: '' },
  raw: { icon: Camera, title: 'Aucun fichier RAW', text: '' },
  trash: { icon: Trash2, title: 'La corbeille est vide', text: 'Les éléments supprimés restent ici 30 jours. Vos fichiers ne sont jamais effacés sans confirmation.' }
} as const

export function EmptySection() {
  const section = useUi((s) => s.section)
  const kind = useUi((s) => s.kind)
  const c = COPY[section] ?? COPY.all
  const Icon = kind === 'video' && section === 'all' ? Video : c.icon
  const title = section === 'all' && kind !== 'all' ? (kind === 'video' ? 'Aucune vidéo' : 'Aucune photo') : c.title
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
