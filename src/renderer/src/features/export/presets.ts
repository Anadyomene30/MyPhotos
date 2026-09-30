import type { ExportOptions } from '@shared/types'

export type ExportSettings = Omit<ExportOptions, 'ids' | 'destination'>

export interface Preset {
  id: string
  title: string
  subtitle: string
  settings: ExportSettings
}

const base: ExportSettings = {
  photo: { format: 'jpeg', maxSize: 2048, quality: 82 },
  video: { format: 'mp4-h264', maxHeight: 1080, quality: 'medium' },
  metadata: 'noLocation',
  naming: 'date',
  folders: 'flat',
  includeLiveVideo: false,
  setFileDates: true
}

export const PRESETS: Preset[] = [
  { id: 'share', title: 'Partager', subtitle: 'Messages, WhatsApp, e-mail', settings: base },
  {
    id: 'web', title: 'Web', subtitle: 'Léger, pour un site ou un blog',
    settings: { ...base, photo: { format: 'webp', maxSize: 1600, quality: 78 }, video: { format: 'mp4-h264', maxHeight: 720, quality: 'small' }, metadata: 'none' }
  },
  {
    id: 'print', title: 'Impression', subtitle: 'Pleine définition, qualité maximale',
    settings: { ...base, photo: { format: 'jpeg', maxSize: null, quality: 95 }, video: { format: 'original', maxHeight: null, quality: 'high' }, metadata: 'all' }
  },
  {
    id: 'archive', title: 'Originaux', subtitle: 'Fichiers identiques, rangés par mois',
    settings: { ...base, photo: { format: 'original', maxSize: null, quality: 95 }, video: { format: 'original', maxHeight: null, quality: 'high' }, metadata: 'all', naming: 'original', folders: 'yearMonth', includeLiveVideo: true, includeRaw: true }
  },
  {
    id: 'edit', title: 'Montage', subtitle: 'Vidéos ProRes pour Final Cut, Premiere, DaVinci',
    settings: { ...base, photo: { format: 'tiff', maxSize: null, quality: 100 }, video: { format: 'mov-prores', maxHeight: null, quality: 'high' }, metadata: 'all', naming: 'original' }
  }
]

export function loadSettings(): { preset: string; settings: ExportSettings } {
  try {
    const raw = JSON.parse(localStorage.getItem('mp-export') ?? 'null') as { preset: string; settings: ExportSettings } | null
    if (raw?.settings?.photo && raw.settings.video) return raw
  } catch {
    /* ignore */
  }
  return { preset: 'share', settings: PRESETS[0]!.settings }
}

export function saveSettings(preset: string, settings: ExportSettings): void {
  try {
    localStorage.setItem('mp-export', JSON.stringify({ preset, settings }))
  } catch {
    /* ignore */
  }
}

export const PHOTO_FORMATS = [
  { value: 'original', label: 'Original (fichier identique)' },
  { value: 'jpeg', label: 'JPEG' },
  { value: 'webp', label: 'WebP' },
  { value: 'avif', label: 'AVIF' },
  { value: 'png', label: 'PNG' },
  { value: 'tiff', label: 'TIFF' }
] as const

export const PHOTO_SIZES = [
  { value: 0, label: 'Taille d’origine' },
  { value: 4096, label: '4096 px (4K)' },
  { value: 2048, label: '2048 px' },
  { value: 1600, label: '1600 px' },
  { value: 1024, label: '1024 px' }
] as const

export const VIDEO_FORMATS = [
  { value: 'original', label: 'Original (fichier identique)' },
  { value: 'mp4-h264', label: 'MP4 · H.264 (compatible partout)' },
  { value: 'mp4-hevc', label: 'MP4 · HEVC (2× plus léger)' },
  { value: 'webm', label: 'WebM · VP9' },
  { value: 'mov-prores', label: 'MOV · ProRes (montage)' },
  { value: 'gif', label: 'GIF animé' }
] as const

export const VIDEO_SIZES = [
  { value: 0, label: 'Résolution d’origine' },
  { value: 2160, label: '4K (2160p)' },
  { value: 1080, label: 'Full HD (1080p)' },
  { value: 720, label: 'HD (720p)' },
  { value: 480, label: 'SD (480p)' }
] as const
