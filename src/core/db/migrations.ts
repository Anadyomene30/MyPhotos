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
  `,
  /* 8 — non-destructive photo edits */ `
  ALTER TABLE assets ADD COLUMN edit TEXT;
  ALTER TABLE assets ADD COLUMN edited_at INTEGER;
  `,
  /* 9 — versions: edited copies stacked under their original */ `
  ALTER TABLE assets ADD COLUMN version_of INTEGER;
  CREATE INDEX assets_version_of ON assets(version_of) WHERE version_of IS NOT NULL;
  `,
  /* 10 — local intelligence: faces, people, CLIP embeddings, categories, places, text search */ `
  ALTER TABLE assets ADD COLUMN ml_state INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN geo_state INTEGER NOT NULL DEFAULT 0;
  ALTER TABLE assets ADD COLUMN place_city TEXT;
  ALTER TABLE assets ADD COLUMN place_admin TEXT;
  ALTER TABLE assets ADD COLUMN place_country TEXT;
  ALTER TABLE assets ADD COLUMN place_cc TEXT;
  CREATE INDEX assets_ml_state ON assets(ml_state) WHERE ml_state = 0;
  CREATE INDEX assets_geo_state ON assets(geo_state) WHERE geo_state = 0;
  CREATE INDEX assets_place ON assets(place_city) WHERE place_city IS NOT NULL;

  CREATE TABLE faces (
    id INTEGER PRIMARY KEY,
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    x REAL NOT NULL, y REAL NOT NULL, w REAL NOT NULL, h REAL NOT NULL,
    kps TEXT,
    score REAL NOT NULL,
    quality REAL NOT NULL,
    person_id INTEGER,
    emb BLOB NOT NULL,
    hidden INTEGER NOT NULL DEFAULT 0
  );
  CREATE INDEX faces_asset ON faces(asset_id);
  CREATE INDEX faces_person ON faces(person_id);

  CREATE TABLE persons (
    id INTEGER PRIMARY KEY,
    name TEXT,
    cover_face_id INTEGER,
    hidden INTEGER NOT NULL DEFAULT 0,
    centroid BLOB,
    n INTEGER NOT NULL DEFAULT 0,
    created_at INTEGER NOT NULL
  );

  CREATE TABLE clip_emb (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    emb BLOB NOT NULL
  );

  CREATE TABLE categories (
    asset_id INTEGER NOT NULL REFERENCES assets(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    score REAL NOT NULL,
    PRIMARY KEY (asset_id, label)
  ) WITHOUT ROWID;
  CREATE INDEX categories_label ON categories(label);

  CREATE TABLE search_text (
    asset_id INTEGER PRIMARY KEY REFERENCES assets(id) ON DELETE CASCADE,
    text TEXT NOT NULL
  );
  CREATE VIRTUAL TABLE search_fts USING fts5(text, content='search_text', content_rowid='asset_id', tokenize='unicode61 remove_diacritics 2');
  CREATE TRIGGER search_text_ai AFTER INSERT ON search_text BEGIN
    INSERT INTO search_fts(rowid, text) VALUES (new.asset_id, new.text);
  END;
  CREATE TRIGGER search_text_ad AFTER DELETE ON search_text BEGIN
    INSERT INTO search_fts(search_fts, rowid, text) VALUES ('delete', old.asset_id, old.text);
  END;
  CREATE TRIGGER search_text_au AFTER UPDATE ON search_text BEGIN
    INSERT INTO search_fts(search_fts, rowid, text) VALUES ('delete', old.asset_id, old.text);
    INSERT INTO search_fts(rowid, text) VALUES (new.asset_id, new.text);
  END;
  `,
  /* 11 — moments, trips, memories */ `
  CREATE TABLE moments (
    id INTEGER PRIMARY KEY,
    sig TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subtitle TEXT,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    day_start TEXT NOT NULL,
    day_end TEXT NOT NULL,
    city TEXT,
    country TEXT,
    lat REAL,
    lon REAL,
    n INTEGER NOT NULL,
    cover_id INTEGER,
    trip_id INTEGER
  );
  CREATE INDEX moments_start ON moments(start_at DESC);
  CREATE TABLE moment_assets (
    moment_id INTEGER NOT NULL REFERENCES moments(id) ON DELETE CASCADE,
    asset_id INTEGER NOT NULL,
    PRIMARY KEY (asset_id)
  ) WITHOUT ROWID;
  CREATE INDEX moment_assets_moment ON moment_assets(moment_id);
  CREATE TABLE moment_titles (
    sig TEXT PRIMARY KEY,
    title TEXT NOT NULL
  );
  CREATE TABLE trips (
    id INTEGER PRIMARY KEY,
    sig TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    start_at INTEGER NOT NULL,
    end_at INTEGER NOT NULL,
    cities TEXT NOT NULL,
    n INTEGER NOT NULL,
    cover_id INTEGER
  );
  CREATE TABLE memories (
    id INTEGER PRIMARY KEY,
    kind TEXT NOT NULL,
    key TEXT NOT NULL UNIQUE,
    title TEXT NOT NULL,
    subtitle TEXT,
    cover_id INTEGER,
    asset_ids TEXT NOT NULL,
    theme TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    dismissed INTEGER NOT NULL DEFAULT 0,
    pinned INTEGER NOT NULL DEFAULT 0,
    album_id INTEGER
  );
  CREATE INDEX memories_kind ON memories(kind);
  `,
  /* 12 — focal point for smart cropping (faces first, then visual saliency) */ `
  ALTER TABLE assets ADD COLUMN focal_x REAL;
  ALTER TABLE assets ADD COLUMN focal_y REAL;
  UPDATE assets SET analyze_state = 0 WHERE analyze_state = 1;
  `
]
