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
  /** number of edited copies stacked under this item */
  versions: number
  /** focal point 0..1 for smart cropping (faces or saliency) */
  fx: number
  fy: number
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
  versionOf: number | null
  place: string | null
  placeCountry: string | null
  categories?: string[]
  versionList: Array<{ id: number; name: string; createdAt: number; v: string }>
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
  person?: number
  category?: string
  place?: string
  /** free text: names, places, people, categories and semantic search */
  search?: string
  /** visually similar to this asset */
  similar?: number
  /** group and order the timeline by moments instead of days */
  group?: 'moments'
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
  /** local calendar day YYYY-MM-DD, 'unknown', 'search', or 'm:<momentId>' when grouped by moments */
  day: string
  count: number
  title?: string
  subtitle?: string
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
  | { type: 'ml-status'; status: MlStatus }
  | { type: 'share-activity'; albumId: number; albumName: string; kind: 'comment' | 'upload' | 'like'; author: string }
  | { type: 'lan-status'; status: LanStatus }
  | { type: 'retro-done'; ok: boolean; assetId: number | null; preview: boolean; file: string | null; error?: string }

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

export interface MlStatus {
  enabled: boolean
  workerAvailable: boolean
  installed: Record<string, boolean>
  packs: Array<{ id: string; title: string; bytes: number }>
  download: { pack: string; done: number; total: number } | null
  running: { faces: boolean; clip: boolean }
  pending: number
  done: number
  persons: number
  error: string | null
}

export interface PersonSummary {
  id: number
  name: string | null
  hidden: boolean
  coverFaceId: number | null
  photos: number
}

export interface PersonPair {
  a: PersonSummary
  b: PersonSummary
  score: number
  /** a few of the clearest faces of each, to decide at a glance */
  aFaces: number[]
  bFaces: number[]
}

export interface SearchHit {
  id: number
  score: number
}

export interface FaceInfo {
  id: number
  x: number
  y: number
  w: number
  h: number
  personId: number | null
  personName: string | null
  quality: number
  suggestions: Array<{ personId: number; name: string | null; score: number }>
}

export interface PlaceSummary {
  city: string
  admin: string | null
  country: string | null
  cc: string | null
  count: number
  lat: number
  lon: number
  coverId: number | null
  coverV: string
}

export interface MomentSummary {
  id: number
  title: string
  subtitle: string | null
  dayStart: string
  dayEnd: string
  city: string | null
  country: string | null
  count: number
  coverId: number | null
  coverV: string
  tripId: number | null
}

export type MemoryKind = 'year' | 'trip' | 'moment' | 'person' | 'category' | 'onThisDay' | 'custom'

export type MemoryPage =
  | { type: 'cover'; ids: number[] }
  | { type: 'title'; text: string; sub?: string }
  | { type: 'hero'; ids: [number] }
  | { type: 'duo'; ids: number[] }
  | { type: 'trio'; ids: number[] }
  | { type: 'grid'; ids: number[] }
  | { type: 'end'; ids: number[] }

export interface MemoryTheme {
  /** dominant colour of the cover, hex */
  accent: string
  /** dark or light text on the accent */
  onAccent: 'light' | 'dark'
  /** page background tint */
  bg: string
}

export interface MemorySummary {
  id: number
  kind: MemoryKind
  title: string
  subtitle: string | null
  coverId: number | null
  coverV: string
  count: number
  pinned: boolean
  albumId: number | null
  theme: MemoryTheme
  createdAt: number
}

export interface MemoryDetail extends MemorySummary {
  assetIds: number[]
  pages: MemoryPage[]
  tiles: AssetTile[]
}

export interface RetroOptions {
  source: { type: 'all' } | { type: 'year'; value: number } | { type: 'album'; value: number } | { type: 'person'; value: number } | { type: 'ids'; value: number[] }
  /** target length in seconds */
  seconds: number
  pace: 'gentle' | 'fast'
  format: '16:9' | '9:16' | '1:1'
  resolution: 720 | 1080 | 2160
  /** absolute path of an audio file on the library computer */
  music?: string | null
  title?: string | null
  subtitle?: string | null
  titleCards: boolean
  includeVideos: boolean
  /** quick low-resolution render */
  preview?: boolean
}

export interface ShareLink {
  id: number
  albumId: number
  token: string
  canAdd: boolean
  hasPin: boolean
  createdAt: number
  expiresAt: number | null
  lastVisit: number | null
}

export interface LanStatus {
  enabled: boolean
  running: boolean
  port: number
  addresses: string[]
  error: string | null
}

export interface SharedAlbumInfo {
  name: string
  count: number
  canAdd: boolean
  owner: string
  coverId: number | null
  locked: boolean
}

export interface ShareComment {
  id: number
  assetId: number | null
  author: string
  text: string
  createdAt: number
}

export interface ShareActivity {
  albumId: number
  albumName: string
  comments: number
  uploads: number
  likes: number
}
