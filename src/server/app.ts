import { dirname, join, normalize, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { mkdir, writeFile } from 'node:fs/promises'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { cors } from 'hono/cors'
import { z } from 'zod'
import { decodeInput, type Library } from '@core/library'
import { thumbKey } from '@core/repo/assets'
import { CATEGORIES } from '@core/ml/categories'
import type { Row } from '@core/db'
import type { LibraryFilter, ServerEvent, TimelineQuery } from '@shared/types'
import { mimeFor, sendFile } from './files'
import { NEUTRAL_VIDEO, type VideoEdit } from '@shared/edit/video'

export interface AppOptions {
  token: string
  rendererDir?: string
  /** extra origin allowed to call the API (the Vite dev server) */
  devOrigin?: string
}

const FILTERS = ['all', 'photos', 'videos', 'live', 'screenshots', 'favorites', 'raw', 'trash'] as const

function timelineQuery(c: Context): TimelineQuery {
  const f = c.req.query('filter') as LibraryFilter | undefined
  const year = c.req.query('year')
  const k = c.req.query('kind')
  const album = c.req.query('album')
  const person = c.req.query('person')
  return {
    album: album ? parseInt(album, 10) || undefined : undefined,
    person: person ? parseInt(person, 10) || undefined : undefined,
    category: c.req.query('category') || undefined,
    place: c.req.query('place') || undefined,
    search: c.req.query('search')?.trim() || undefined,
    similar: c.req.query('similar') ? parseInt(c.req.query('similar')!, 10) || undefined : undefined,
    group: c.req.query('group') === 'moments' ? 'moments' : undefined,
    filter: f && (FILTERS as readonly string[]).includes(f) ? f : 'all',
    kind: k === 'photo' || k === 'video' ? k : 'all',
    year: year ? parseInt(year, 10) || undefined : undefined
  }
}

const idParam = (c: Context): number => parseInt(c.req.param('id') ?? '', 10)

export function createApp(lib: Library, opts: AppOptions): Hono {
  const app = new Hono()

  if (opts.devOrigin) app.use('/api/*', cors({ origin: opts.devOrigin, allowHeaders: ['x-token', 'content-type', 'range'], allowMethods: ['GET', 'POST', 'PATCH', 'DELETE'] }))

  app.use('/api/*', async (c, next) => {
    const t = c.req.header('x-token') ?? c.req.query('t')
    if (t !== opts.token) return c.json({ error: 'unauthorized' }, 401)
    await next()
  })

  app.onError((err, c) => c.json({ error: err.message }, 500))

  app.get('/api/health', (c) => c.json({ ok: true }))
  app.get('/api/state', (c) => c.json(lib.state()))

  app.get('/api/events', (c) =>
    streamSSE(c, async (stream) => {
      const handler = (e: ServerEvent): void => {
        void stream.writeSSE({ data: JSON.stringify(e) })
      }
      lib.on('event', handler)
      stream.onAbort(() => {
        lib.off('event', handler)
      })
      await stream.writeSSE({ data: JSON.stringify({ type: 'jobs', jobs: lib.jobs() } satisfies ServerEvent) })
      while (!stream.aborted) await stream.sleep(25000).then(() => stream.writeSSE({ event: 'ping', data: '' }))
    })
  )

  app.post('/api/sources', async (c) => {
    const body = z.object({ path: z.string().min(1) }).parse(await c.req.json())
    try {
      return c.json(await lib.addSource(body.path))
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.delete('/api/sources/:id', (c) => {
    lib.removeSource(idParam(c))
    return c.json({ ok: true })
  })
  app.post('/api/rescan', (c) => {
    void lib.rescanAll()
    return c.json({ ok: true })
  })

  /** Search results are one ranked list shown as a single group. */
  const searchTiles = async (q: TimelineQuery): Promise<number[]> => {
    const ids = q.similar ? lib.ml.similar(q.similar, 200).map((h) => h.id) : (await lib.searchIds(q.search!)).ids
    return lib.assets.tilesByIds(q, ids).map((t) => t.id)
  }
  app.get('/api/timeline/buckets', async (c) => {
    const q = timelineQuery(c)
    if (q.group === 'moments') lib.ensureMoments()
    if (q.search || q.similar) {
      const ids = await searchTiles(q)
      return c.json(ids.length ? [{ day: 'search', count: ids.length }] : [])
    }
    return c.json(lib.assets.buckets(q))
  })
  app.get('/api/timeline/page', async (c) => {
    const q = timelineQuery(c)
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0)
    const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') ?? '200', 10) || 200))
    if (q.search || q.similar) {
      const ids = await searchTiles(q)
      return c.json(lib.assets.tilesByIds(q, ids.slice(offset, offset + limit)))
    }
    return c.json(lib.assets.page(q, offset, limit))
  })
  app.get('/api/timeline/ids', async (c) => {
    const q = timelineQuery(c)
    return c.json(q.search || q.similar ? await searchTiles(q) : lib.assets.ids(q))
  })
  app.get('/api/timeline/index/:id', async (c) => {
    const q = timelineQuery(c)
    if (q.search || q.similar) {
      const i = (await searchTiles(q)).indexOf(idParam(c))
      return c.json({ index: i >= 0 ? i : null })
    }
    return c.json({ index: lib.assets.indexOf(q, idParam(c)) })
  })
  app.get('/api/years', (c) => c.json(lib.assets.years()))

  app.post('/api/assets/summary', async (c) => {
    const body = z.object({ ids: z.array(z.number().int()).max(200000) }).parse(await c.req.json())
    const rows = lib.db
      .prepare('SELECT kind, count(*) AS n, sum(is_live) AS live, sum(size) AS bytes FROM assets WHERE id IN (SELECT value FROM json_each(?)) GROUP BY kind')
      .all(JSON.stringify(body.ids)) as Array<{ kind: string; n: number; live: number; bytes: number }>
    const photo = rows.find((r) => r.kind === 'photo')
    const video = rows.find((r) => r.kind === 'video')
    return c.json({ photos: photo?.n ?? 0, videos: video?.n ?? 0, live: photo?.live ?? 0, bytes: rows.reduce((a, r) => a + (r.bytes ?? 0), 0) })
  })

  app.get('/api/assets/:id', (c) => {
    const d = lib.assets.detail(idParam(c))
    return d ? c.json(d) : c.json({ error: 'not found' }, 404)
  })
  app.put('/api/assets/:id/edit', async (c) => {
    const body = (await c.req.json()) as { edit: unknown }
    try {
      await lib.setEdit(idParam(c), body.edit ? (body.edit as never) : null)
      return c.json(lib.assets.detail(idParam(c)))
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.post('/api/assets/:id/edited-copy', async (c) => {
    const body = (await c.req.json()) as { edit: unknown }
    try {
      return c.json({ jobId: lib.startEditedCopy(idParam(c), body.edit as never) })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.post('/api/assets/:id/detach', (c) => {
    lib.detachVersion(idParam(c))
    return c.json({ ok: true })
  })
  /** Unedited, orientation-corrected source for the editor (never the edited render). */
  app.get('/api/source/:id', async (c) => {
    const d = lib.assets.raw(idParam(c))
    if (!d) return c.body(null, 404)
    const file = await lib.sourcePreview(idParam(c))
    return file ? sendFile(c, file, { type: 'image/webp', cache: 'private, max-age=3600' }) : c.body(null, 404)
  })
  app.patch('/api/assets', async (c) => {
    const body = z
      .object({ ids: z.array(z.number().int()).min(1).max(100000), favorite: z.boolean().optional(), trashed: z.boolean().optional() })
      .parse(await c.req.json())
    if (body.favorite !== undefined) lib.setFavorite(body.ids, body.favorite)
    if (body.trashed !== undefined) lib.setTrashed(body.ids, body.trashed)
    return c.json({ ok: true })
  })

  // ------------------------------------------------------------ albums
  const smartRule = z.union([
    z.object({ field: z.literal('kind'), value: z.enum(['photo', 'video']) }),
    z.object({ field: z.enum(['favorite', 'live', 'screenshot', 'raw', 'hasLocation', 'noLocation']) }),
    z.object({ field: z.literal('year'), op: z.enum(['is', 'before', 'after']), value: z.number().int() }),
    z.object({ field: z.literal('month'), value: z.number().int().min(1).max(12) }),
    z.object({ field: z.literal('dateRange'), from: z.string(), to: z.string() }),
    z.object({ field: z.enum(['camera', 'folder', 'name']), op: z.enum(['contains', 'notContains']), value: z.string() }),
    z.object({ field: z.literal('ext'), value: z.string() }),
    z.object({ field: z.literal('album'), op: z.enum(['in', 'notIn']), value: z.number().int() })
  ])
  const smartRules = z.object({ match: z.enum(['all', 'any']), rules: z.array(smartRule).max(50) })

  app.get('/api/albums', (c) => c.json(lib.albums.list()))
  app.get('/api/albums/:id', (c) => {
    const a = lib.albums.get(idParam(c))
    return a ? c.json(a) : c.json({ error: 'not found' }, 404)
  })
  app.post('/api/albums', async (c) => {
    const body = z
      .object({ name: z.string().max(200), kind: z.enum(['manual', 'smart']).default('manual'), rules: smartRules.optional(), assetIds: z.array(z.number().int()).max(200000).optional() })
      .parse(await c.req.json())
    const a = lib.albums.create(body.name, body.kind, body.kind === 'smart' ? (body.rules ?? { match: 'all', rules: [] }) : null, body.assetIds)
    lib.changed()
    return c.json(a)
  })
  app.patch('/api/albums/:id', async (c) => {
    const body = z.object({ name: z.string().max(200).optional(), rules: smartRules.optional(), coverId: z.number().int().nullable().optional() }).parse(await c.req.json())
    const a = lib.albums.update(idParam(c), body)
    lib.changed()
    return a ? c.json(a) : c.json({ error: 'not found' }, 404)
  })
  app.delete('/api/albums/:id', (c) => {
    lib.albums.remove(idParam(c))
    lib.changed()
    return c.json({ ok: true })
  })
  app.post('/api/albums/:id/assets', async (c) => {
    const body = z.object({ ids: z.array(z.number().int()).min(1).max(200000) }).parse(await c.req.json())
    const added = lib.albums.addAssets(idParam(c), body.ids)
    lib.changed()
    return c.json({ added })
  })
  app.delete('/api/albums/:id/assets', async (c) => {
    const body = z.object({ ids: z.array(z.number().int()).min(1).max(200000) }).parse(await c.req.json())
    const removed = lib.albums.removeAssets(idParam(c), body.ids)
    lib.changed()
    return c.json({ removed })
  })
  app.get('/api/assets/:id/albums', (c) => c.json(lib.albums.forAsset(idParam(c))))

  // ------------------------------------------------------------ moments & memories
  app.get('/api/moments', (c) => c.json(lib.moments()))
  app.patch('/api/moments/:id', async (c) => {
    const body = z.object({ title: z.string().max(120) }).parse(await c.req.json())
    lib.renameMoment(idParam(c), body.title)
    return c.json({ ok: true })
  })
  app.get('/api/memories', async (c) => {
    const list = lib.memories()
    // first visit waits for the proposals; afterwards they refresh in the background
    if (!list.length) await lib.ensureMemories(true)
    else void lib.ensureMemories()
    return c.json(list.length ? list : lib.memories())
  })
  app.get('/api/memories/:id', (c) => {
    const m = lib.memory(idParam(c))
    return m ? c.json(m) : c.json({ error: 'not found' }, 404)
  })
  app.patch('/api/memories/:id', async (c) => {
    const body = z.object({ title: z.string().max(120).optional(), subtitle: z.string().max(200).nullable().optional(), pinned: z.boolean().optional(), dismissed: z.boolean().optional(), assetIds: z.array(z.number().int()).optional(), coverId: z.number().int().optional() }).parse(await c.req.json())
    lib.updateMemory(idParam(c), body)
    return c.json({ ok: true })
  })
  app.post('/api/memories/:id/album', (c) => c.json({ albumId: lib.saveMemoryAsAlbum(idParam(c)) }))
  app.post('/api/memories/:id/regenerate', (c) => {
    lib.regenerateMemory(idParam(c))
    return c.json({ ok: true })
  })
  app.post('/api/memories/:id/enrich', async (c) => {
    try {
      return c.json(await lib.enrichMemory(idParam(c)))
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.post('/api/memories/:id/pdf', async (c) => {
    const body = z.object({ format: z.enum(['square', 'a4', 'large']).default('square') }).parse(await c.req.json().catch(() => ({})))
    try {
      const m = lib.memory(idParam(c))
      if (!m) return c.json({ error: 'not found' }, 404)
      const file = await lib.printMemoryPdf(m.id, m.title, body.format)
      return c.json({ file })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.get('/api/organize/plan/:id', (c) => {
    try {
      const p = lib.movePlan(idParam(c))
      return c.json({ count: p.items.length, alreadyTidy: p.alreadyTidy, skipped: p.skipped, sample: p.sample, sourcePath: p.sourcePath })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.post('/api/organize/apply/:id', (c) => {
    try {
      return c.json({ jobId: lib.startMove(idParam(c)) })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.get('/api/settings/cloud', (c) => c.json({ hasKey: Boolean(lib.setting('anthropic_api_key')) }))
  app.put('/api/settings/cloud', async (c) => {
    const body = z.object({ apiKey: z.string().max(300).nullable() }).parse(await c.req.json())
    lib.setSetting('anthropic_api_key', body.apiKey?.trim() || null)
    return c.json({ hasKey: Boolean(lib.setting('anthropic_api_key')) })
  })

  // ------------------------------------------------------------ intelligence
  app.get('/api/ml/status', (c) => c.json(lib.ml.status()))
  app.post('/api/ml/enable', async (c) => {
    const body = z.object({ enabled: z.boolean() }).parse(await c.req.json())
    lib.ml.setEnabled(body.enabled)
    if (body.enabled) void lib.ml.ensureStarted().then(() => lib.kickIndexer())
    return c.json(lib.ml.status())
  })
  app.post('/api/ml/download/:pack', (c) => {
    const pack = c.req.param('pack')
    lib.ml.download(pack).then(() => lib.kickIndexer()).catch(() => undefined)
    return c.json({ ok: true })
  })
  app.delete('/api/ml/download', (c) => {
    lib.ml.cancelDownload()
    return c.json({ ok: true })
  })

  app.get('/api/persons', (c) => c.json(lib.ml.persons(c.req.query('all') === '1')))
  app.patch('/api/persons/:id', async (c) => {
    const body = z.object({ name: z.string().max(100).nullable().optional(), hidden: z.boolean().optional() }).parse(await c.req.json())
    if (body.name !== undefined) lib.ml.renamePerson(idParam(c), body.name)
    if (body.hidden !== undefined) lib.ml.hidePerson(idParam(c), body.hidden)
    return c.json({ ok: true })
  })
  app.post('/api/persons/merge', async (c) => {
    const body = z.object({ into: z.number().int(), from: z.array(z.number().int()).min(1) }).parse(await c.req.json())
    lib.ml.mergePersons(body.into, body.from)
    return c.json({ ok: true })
  })
  app.post('/api/persons/:id/cover', async (c) => {
    const body = z.object({ faceId: z.number().int() }).parse(await c.req.json())
    lib.ml.setCover(idParam(c), body.faceId)
    return c.json({ ok: true })
  })
  app.get('/api/assets/:id/faces', (c) => c.json(lib.ml.facesOf(idParam(c))))
  app.post('/api/faces/:id/move', async (c) => {
    const body = z.object({ personId: z.number().int().nullable() }).parse(await c.req.json())
    lib.ml.moveFace(idParam(c), body.personId)
    return c.json({ ok: true })
  })
  app.post('/api/faces/:id/person', async (c) => {
    const body = z.object({ name: z.string().min(1).max(100) }).parse(await c.req.json())
    return c.json({ personId: lib.ml.createPersonFromFace(idParam(c), body.name) })
  })
  app.get('/api/face/:id', async (c) => {
    const file = await lib.ml.faceThumb(idParam(c), async (assetId) => {
      const r = lib.assets.raw(assetId)
      return r ? decodeInput(r) : null
    })
    return file ? sendFile(c, file, { type: 'image/webp', cache: 'private, max-age=86400' }) : c.body(null, 404)
  })
  app.get('/api/categories', (c) => {
    const rows = lib.db.prepare(`SELECT c.label, count(*) AS n, max(a.id) AS cover FROM categories c JOIN assets a ON a.id = c.asset_id
        WHERE a.hidden = 0 AND a.missing_at IS NULL AND a.trashed_at IS NULL GROUP BY c.label ORDER BY n DESC`).all() as Array<{ label: string; n: number; cover: number }>
    return c.json(rows.map((r) => ({ id: r.label, label: CATEGORIES.find((x) => x.id === r.label)?.label ?? r.label, count: r.n, coverId: r.cover })))
  })
  app.get('/api/places', (c) => {
    const rows = lib.db.prepare(`SELECT place_city AS city, place_admin AS admin, place_country AS country, place_cc AS cc, count(*) AS n,
        avg(lat) AS lat, avg(lon) AS lon, max(id) AS cover
      FROM assets WHERE place_city IS NOT NULL AND hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL
      GROUP BY place_city, place_cc ORDER BY n DESC`).all() as Array<{ city: string; admin: string | null; country: string | null; cc: string | null; n: number; lat: number; lon: number; cover: number }>
    return c.json(rows.map((r) => {
      const cv = lib.assets.raw(r.cover)
      return { city: r.city, admin: r.admin, country: r.country, cc: r.cc, count: r.n, lat: r.lat, lon: r.lon, coverId: r.cover, coverV: cv ? thumbKey(cv) : '' }
    }))
  })
  app.get('/api/places/points', (c) => {
    const rows = lib.db.prepare(`SELECT id, lat, lon, thumb_v, qhash, kind FROM assets WHERE lat IS NOT NULL AND hidden = 0 AND missing_at IS NULL AND trashed_at IS NULL`).all() as Row[]
    return c.json({ type: 'FeatureCollection', features: rows.map((r) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [r.lon, r.lat] }, properties: { id: r.id, v: thumbKey(r), kind: r.kind } })) })
  })
  /** Map tile proxy with on-disk cache (OpenStreetMap usage policy requires an identifying user agent). */
  app.get('/api/tiles/:z/:x/:y', async (c) => {
    const z = parseInt(c.req.param('z'), 10)
    const x = parseInt(c.req.param('x'), 10)
    const y = parseInt(c.req.param('y').replace(/\.png$/, ''), 10)
    if (!Number.isInteger(z) || !Number.isInteger(x) || !Number.isInteger(y) || z < 0 || z > 19 || x < 0 || y < 0 || x >= 2 ** z || y >= 2 ** z) return c.body(null, 400)
    const file = lib.tilePath(z, x, y)
    if (!existsSync(file)) {
      try {
        const res = await fetch(`https://tile.openstreetmap.org/${z}/${x}/${y}.png`, { headers: { 'User-Agent': 'MyPhotos/0.1 (personal photo library; contact via github)' } })
        if (!res.ok) return c.body(null, 502)
        const buf = Buffer.from(await res.arrayBuffer())
        await mkdir(dirname(file), { recursive: true })
        await writeFile(file, buf)
      } catch {
        return c.body(null, 502)
      }
    }
    return sendFile(c, file, { type: 'image/png', cache: 'private, max-age=604800' })
  })

  app.get('/api/similar/:id', (c) => c.json(lib.ml.similar(idParam(c))))

  // ------------------------------------------------------------ cleanup
  app.get('/api/cleanup', (c) => c.json(lib.cleanupReport()))
  app.post('/api/cleanup/exact', async (c) => {
    const body = z.object({ groups: z.array(z.object({ keep: z.number().int(), remove: z.array(z.number().int()).min(1) })).min(1).max(50000) }).parse(await c.req.json())
    return c.json(await lib.resolveExactDuplicates(body.groups))
  })
  app.post('/api/cleanup/ignore', async (c) => {
    const body = z.object({ signature: z.string().min(1).max(100000), kind: z.string().max(40) }).parse(await c.req.json())
    lib.ignoreCleanup(body.signature, body.kind)
    return c.json({ ok: true })
  })

  app.post('/api/video-edit/:id', async (c) => {
    const body = (await c.req.json()) as { edit: VideoEdit }
    try {
      return c.json({ jobId: lib.startVideoEdit(idParam(c), { ...NEUTRAL_VIDEO, ...body.edit }) })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  app.post('/api/fusion', async (c) => {
    const body = z.object({ ids: z.array(z.number().int()).min(2).max(15) }).parse(await c.req.json())
    try {
      return c.json({ jobId: lib.startFusion(body.ids) })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  // ------------------------------------------------------------ export
  const exportSchema = z.object({
    ids: z.array(z.number().int()).min(1).max(200000),
    destination: z.string().min(1),
    photo: z.object({ format: z.enum(['original', 'jpeg', 'png', 'webp', 'avif', 'tiff']), maxSize: z.number().int().min(64).max(20000).nullable(), quality: z.number().min(1).max(100) }),
    video: z.object({ format: z.enum(['original', 'mp4-h264', 'mp4-hevc', 'webm', 'mov-prores', 'gif']), maxHeight: z.number().int().min(144).max(4320).nullable(), quality: z.enum(['high', 'medium', 'small']) }),
    metadata: z.enum(['all', 'noLocation', 'none']),
    naming: z.enum(['original', 'date', 'custom']),
    pattern: z.string().max(200).optional(),
    folders: z.enum(['flat', 'year', 'yearMonth']),
    includeLiveVideo: z.boolean(),
    includeRaw: z.boolean().optional(),
    setFileDates: z.boolean()
  })
  app.post('/api/export', async (c) => {
    const body = exportSchema.parse(await c.req.json())
    try {
      return c.json({ jobId: lib.startExport(body) })
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })
  app.delete('/api/jobs/:id', (c) => {
    lib.cancelJob(c.req.param('id'))
    return c.json({ ok: true })
  })

  app.post('/api/trash/empty', async (c) => {
    const body = z.object({ ids: z.array(z.number().int()).optional() }).parse(await c.req.json().catch(() => ({})))
    try {
      return c.json(await lib.emptyTrash(body.ids))
    } catch (e) {
      return c.json({ error: (e as Error).message }, 400)
    }
  })

  const IMMUTABLE = 'private, max-age=31536000, immutable'

  app.get('/api/thumb/:id', async (c) => {
    const file = await lib.thumbnail(idParam(c), 'grid')
    return file ? sendFile(c, file, { type: 'image/webp', cache: IMMUTABLE }) : c.body(null, 404)
  })

  app.get('/api/preview/:id', async (c) => {
    const d = lib.assets.detail(idParam(c))
    if (!d) return c.body(null, 404)
    if (d.kind === 'photo' && d.webNative) return sendFile(c, d.path, { cache: IMMUTABLE })
    const file = await lib.thumbnail(d.id, 'preview')
    return file ? sendFile(c, file, { type: 'image/webp', cache: IMMUTABLE }) : c.body(null, 404)
  })

  app.get('/api/original/:id', async (c) => {
    const d = lib.assets.detail(idParam(c))
    if (!d) return c.body(null, 404)
    return sendFile(c, d.path, { download: c.req.query('download') ? d.name : undefined })
  })

  app.get('/api/live/:id', async (c) => {
    const r = lib.assets.raw(idParam(c))
    const live = r?.live_video as string | undefined
    return live ? sendFile(c, live, { type: mimeFor(live) === 'video/quicktime' ? 'video/mp4' : mimeFor(live) }) : c.body(null, 404)
  })

  // Web client (same bundle as the desktop renderer), for LAN sharing and headless development.
  const dir = opts.rendererDir
  if (dir && existsSync(join(dir, 'index.html'))) {
    app.get('*', async (c) => {
      const url = new URL(c.req.url)
      const rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
      const file = join(dir, rel)
      if (rel && file.startsWith(dir + sep) && existsSync(file)) {
        return sendFile(c, file, { cache: rel.startsWith('assets') ? IMMUTABLE : undefined })
      }
      const res = await sendFile(c, join(dir, 'index.html'))
      res.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob: https://tile.openstreetmap.org; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self' blob:; worker-src 'self' blob:; child-src blob:; connect-src 'self' https://tile.openstreetmap.org; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
      return res
    })
  }

  return app
}
