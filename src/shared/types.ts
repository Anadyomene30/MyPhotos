export type AssetKind = 'photo' | 'video'

/** Compact asset row used by grids. Keep it small: the timeline may page through 200k of them. */
export interface AssetTile {
  id: number
  kind: AssetKind
  /** width / height after orientation, 1 when unknown */
  ratio: number
  takenAt: number
  duration: number | null
  live: boolean
  favorite: boolean
  raw: boolean
  /** has non-destructive edits */
  edited: boolean
  /** cache key of the thumbnail: changes with the file content or a regeneration */
  v: string
}

export interface AssetDetail extends AssetTile {
  path: string
  name: string
  ext: string
  size: number
  width: number | null
  height: number | null
  day: string | null
  tzOffset: number | null
  lat: number | null
  lon: number | null
  make: string | null
  model: string | null
  lens: string | null
  iso: number | null
  fnumber: number | null
  exposure: number | null
  focal: number | null
  screenshot: boolean
  rating: number
  hasLiveVideo: boolean
  /** path of the RAW file paired with this JPEG/HEIC */
  rawCompanion: string | null
  /** true when the browser can display the original file directly */
  webNative: boolean
  edit: import('./edit/types').PhotoEdit | null
  trashedAt: number | null
}

export type LibraryFilter =
  | 'all'
  | 'photos'
  | 'videos'
  | 'live'
  | 'screenshots'
  | 'favorites'
  | 'raw'
  | 'trash'

export type KindFilter = 'all' | 'photo' | 'video'

export interface TimelineQuery {
  filter: LibraryFilter
  kind?: KindFilter
  year?: number
  album?: number
}

export type SmartRule =
  | { field: 'kind'; value: 'photo' | 'video' }
  | { field: 'favorite' | 'live' | 'screenshot' | 'raw' | 'hasLocation' | 'noLocation' }
  | { field: 'year'; op: 'is' | 'before' | 'after'; value: number }
  | { field: 'month'; value: number }
  | { field: 'dateRange'; from: string; to: string }
  | { field: 'camera' | 'folder' | 'name'; op: 'contains' | 'notContains'; value: string }
  | { field: 'ext'; value: string }
  | { field: 'album'; op: 'in' | 'notIn'; value: number }

export interface SmartRules {
  match: 'all' | 'any'
  rules: SmartRule[]
}

export interface Album {
  id: number
  name: string
  kind: 'manual' | 'smart'
  rules: SmartRules | null
  count: number
  coverId: number | null
  coverV: string
  createdAt: number
  updatedAt: number
}

export interface DayBucket {
  /** local calendar day YYYY-MM-DD, or 'unknown' */
  day: string
  count: number
}

export interface Source {
  id: number
  path: string
  addedAt: number
  assetCount: number
}

export interface JobGroupState {
  id: string
  label: string
  total: number
  done: number
  failed: number
  /** 0..1 when finer than done/total (video encoding) */
  progress?: number
  cancellable?: boolean
}

export interface LibraryCounts {
  all: number
  photos: number
  videos: number
  live: number
  screenshots: number
  favorites: number
  raw: number
  trash: number
}

export interface LibraryState {
  sources: Source[]
  counts: LibraryCounts
  jobs: JobGroupState[]
  scanning: boolean
  version: number
}

export type ServerEvent =
  | { type: 'jobs'; jobs: JobGroupState[] }
  | { type: 'library-changed'; version: number }
  | { type: 'scan'; scanning: boolean }
  | { type: 'export-done'; result: ExportResult }
  | { type: 'creation-done'; ok: boolean; assetId: number | null; error?: string; sources: number[] }

export type PhotoFormat = 'original' | 'jpeg' | 'png' | 'webp' | 'avif' | 'tiff'
export type VideoFormat = 'original' | 'mp4-h264' | 'mp4-hevc' | 'webm' | 'mov-prores' | 'gif'

export interface ExportOptions {
  ids: number[]
  destination: string
  photo: { format: PhotoFormat; maxSize: number | null; quality: number }
  video: { format: VideoFormat; maxHeight: number | null; quality: 'high' | 'medium' | 'small' }
  metadata: 'all' | 'noLocation' | 'none'
  naming: 'original' | 'date' | 'custom'
  pattern?: string
  folders: 'flat' | 'year' | 'yearMonth'
  includeLiveVideo: boolean
  /** also copy the RAW file paired with a JPEG */
  includeRaw?: boolean
  setFileDates: boolean
}

export interface ExportResult {
  jobId: string
  exported: number
  failed: number
  skipped: number
  destination: string
  cancelled: boolean
  errors: string[]
}

export interface CleanupItem {
  id: number
  name: string
  relDir: string
  ext: string
  kind: AssetKind
  size: number
  takenAt: number
  width: number | null
  height: number | null
  duration: number | null
  quality: number | null
  favorite: boolean
  v: string
}

export interface CleanupGroup {
  /** stable signature (sorted ids) used to ignore a group */
  key: string
  items: CleanupItem[]
  keepId: number
  /** why the suggested item is the one to keep */
  reasons: string[]
  /** bytes freed by removing every item except keepId */
  reclaimable: number
}

export type SuggestionKind = 'screenshots' | 'blurry' | 'dark' | 'overexposed' | 'shortVideos' | 'largeVideos'

export interface SuggestionCategory {
  id: SuggestionKind
  title: string
  description: string
  items: CleanupItem[]
  bytes: number
}

export interface CleanupReport {
  exact: CleanupGroup[]
  /** exposure bracketing series that can be fused into one well-exposed photo */
  brackets: CleanupGroup[]
  visual: CleanupGroup[]
  similar: CleanupGroup[]
  suggestions: SuggestionCategory[]
  analyzed: number
  total: number
  version: number
}
