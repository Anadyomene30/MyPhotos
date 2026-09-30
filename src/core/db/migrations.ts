/** Ordered list of schema migrations. Never edit a shipped entry: append a new one. */
export const migrations: string[] = [
  /* 1 — initial schema */ `
  CREATE TABLE sources (
    id INTEGER PRIMARY KEY,
    path TEXT NOT NULL UNIQUE,
    added_at INTEGER NOT NULL
  );

  CREATE TABLE assets (
    id INTEGER PRIMARY KEY,
    source_id INTEGER NOT NULL REFERENCES sources(id) ON DELETE CASCADE,
    path TEXT NOT NULL UNIQUE,
    rel_dir TEXT NOT NULL,
    name TEXT NOT NULL,
    stem TEXT NOT NULL,
    ext TEXT NOT NULL,
    kind TEXT NOT NULL,
    size INTEGER NOT NULL,
    mtime INTEGER NOT NULL,
    taken_at INTEGER NOT NULL,
    tz_offset INTEGER,
    day TEXT NOT NULL,
    date_source TEXT,
    width INTEGER,
    height INTEGER,
    orientation INTEGER,
    ratio REAL,
    duration REAL,
    lat REAL,
    lon REAL,
    make TEXT,
    model TEXT,
    lens TEXT,
    iso INTEGER,
    fnumber REAL,
    exposure REAL,
    focal REAL,
    is_raw INTEGER NOT NULL DEFAULT 0,
    is_screenshot INTEGER NOT NULL DEFAULT 0,
    is_live INTEGER NOT NULL DEFAULT 0,
    live_video TEXT,
    hidden INTEGER NOT NULL DEFAULT 0,
    content_id TEXT,
    qhash TEXT,
    sha256 TEXT,
    phash TEXT,
    ph0 INTEGER, ph1 INTEGER, ph2 INTEGER, ph3 INTEGER,
    quality REAL,
    favorite INTEGER NOT NULL DEFAULT 0,
    rating INTEGER NOT NULL DEFAULT 0,
    meta_state INTEGER NOT NULL DEFAULT 0,
    thumb_state INTEGER NOT NULL DEFAULT 0,
    thumb_v INTEGER NOT NULL DEFAULT 0,
    missing_at INTEGER,
    trashed_at INTEGER,
    added_at INTEGER NOT NULL
  );

  CREATE INDEX assets_timeline ON assets(day DESC, taken_at DESC, id DESC)
    WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL;
  CREATE INDEX assets_kind_timeline ON assets(kind, day DESC, taken_at DESC, id DESC)
    WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL;
  CREATE INDEX assets_source ON assets(source_id);
  CREATE INDEX assets_stem ON assets(source_id, rel_dir, stem);
  CREATE INDEX assets_meta_state ON assets(meta_state) WHERE meta_state = 0;
  CREATE INDEX assets_thumb_state ON assets(thumb_state) WHERE thumb_state = 0;
  CREATE INDEX assets_qhash ON assets(qhash);
  CREATE INDEX assets_sha256 ON assets(sha256);
  CREATE INDEX assets_trashed ON assets(trashed_at) WHERE trashed_at IS NOT NULL;

  CREATE TABLE settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
  );
  `,
  /* 2 — covering index so library counts never scan the wide assets table */ `
  CREATE INDEX assets_counts ON assets(kind, is_live, is_screenshot, favorite, is_raw)
    WHERE hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL;
  `,
  /* 3 — albums (manual and smart) */ `
  CREATE TABLE albums (
    id INTEGER PRIMARY KEY,
    name TEXT NOT NULL,
    kind TEXT NOT NULL DEFAULT 'manual',
    rules TEXT,
    cover_id INTEGER REFERENCES assets(id) ON DELETE SET NULL,
    sort_order REAL NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL
  );
  CREATE TABLE album_assets (
    album_id INTEGER NOT NULL REFERENCES albums(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    added_at INTEGER NOT NULL,
    PRIMARY KEY (album_id, asset_id)
  ) WITHOUT ROWID;
  CREATE INDEX album_assets_asset ON album_assets(asset_id);
  `,
  /* 4 — image analysis for cleanup (perceptual hash, sharpness, exposure) */ `
  ALTER TABLE assets ADD COLUMN sharpness REAL;
  ALTER TABLE assets ADD COLUMN brightness REAL;
  ALTER TABLE assets ADD COLUMN clip_dark REAL;
  ALTER TABLE assets ADD COLUMN clip_bright REAL;
  ALTER TABLE assets ADD COLUMN analyze_state INTEGER NOT NULL DEFAULT 0;
  CREATE INDEX assets_analyze_state ON assets(analyze_state) WHERE analyze_state = 0;
  CREATE TABLE cleanup_ignored (
    signature TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `,
  /* 5 — contrast, to tell blurry photos from smooth scenes */ `
  ALTER TABLE assets ADD COLUMN contrast REAL;
  UPDATE assets SET analyze_state = 0 WHERE analyze_state = 1;
  `,
  /* 6 — RAW + JPEG pairs shown as one item (the RAW file rides along like a Live Photo video) */ `
  ALTER TABLE assets ADD COLUMN raw_companion TEXT;
  UPDATE assets SET meta_state = 0 WHERE width IS NULL AND kind = 'photo' AND ext IN ('tif', 'tiff', 'png', 'webp', 'gif', 'avif', 'jpg', 'jpeg');
  `,
  /* 7 — sub-second capture times and creations (derived photos such as HDR fusions) */ `
  UPDATE assets SET meta_state = 0 WHERE kind = 'photo' AND date_source = 'exif';
  CREATE TABLE creations (
    path TEXT PRIMARY KEY,
    kind TEXT NOT NULL,
    sources TEXT NOT NULL,
    created_at INTEGER NOT NULL
  );
  `
]
