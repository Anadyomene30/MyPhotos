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
  /** bumps when the thumbnail changes, used for cache busting */
  v: number
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
  /** true when the browser can display the original file directly */
  webNative: boolean
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
  coverV: number
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
