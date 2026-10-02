import { t } from '@/i18n'
import { GlobeScene } from '@/components/Globe'
import { useUi } from '@/store'

const COPY = {
  all: { title: t('Rien à afficher'), text: t('Les photos et vidéos de vos dossiers apparaîtront ici.') },
  photos: { title: t('Aucune photo'), text: '' },
  videos: { title: t('Aucune vidéo'), text: '' },
  favorites: { title: t('Aucun favori'), text: t('Sélectionnez une photo et appuyez sur « . » pour l’ajouter à vos favoris.') },
  live: { title: t('Aucune Live Photo'), text: t('Les Live Photos d’iPhone (HEIC + MOV) sont détectées automatiquement.') },
  screenshots: { title: t('Aucune capture d’écran'), text: '' },
  raw: { title: t('Aucun fichier RAW'), text: '' },
  trash: { title: t('La corbeille est vide'), text: t('Les éléments supprimés restent ici 30 jours. Vos fichiers ne sont jamais effacés sans confirmation.') }
} as const

export function EmptySection() {
  const section = useUi((s) => s.section)
  const kind = useUi((s) => s.kind)
  const c = COPY[section] ?? COPY.all
  const title = section === 'all' && kind !== 'all' ? (kind === 'video' ? t('Aucune vidéo') : t('Aucune photo')) : c.title
  return (
    <div className="grid h-full place-items-center pt-12">
      <div className="animate-fade-in flex max-w-sm flex-col items-center text-center">
        <div className="mb-5">
          <GlobeScene size={104} />
        </div>
        <h2 className="font-display text-[20px] font-bold">{title}</h2>
        {c.text && <p className="mt-2 text-[13px] leading-relaxed text-muted">{c.text}</p>}
      </div>
    </div>
  )
}
