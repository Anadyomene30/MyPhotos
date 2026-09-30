import { join, normalize, sep } from 'node:path'
import { existsSync } from 'node:fs'
import { Hono, type Context } from 'hono'
import { streamSSE } from 'hono/streaming'
import { cors } from 'hono/cors'
import { z } from 'zod'
import type { Library } from '@core/library'
import type { LibraryFilter, ServerEvent, TimelineQuery } from '@shared/types'
import { mimeFor, sendFile } from './files'

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
  return {
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

  app.get('/api/timeline/buckets', (c) => c.json(lib.assets.buckets(timelineQuery(c))))
  app.get('/api/timeline/page', (c) => {
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0)
    const limit = Math.min(1000, Math.max(1, parseInt(c.req.query('limit') ?? '200', 10) || 200))
    return c.json(lib.assets.page(timelineQuery(c), offset, limit))
  })
  app.get('/api/timeline/ids', (c) => c.json(lib.assets.ids(timelineQuery(c))))
  app.get('/api/timeline/index/:id', (c) => c.json({ index: lib.assets.indexOf(timelineQuery(c), idParam(c)) }))
  app.get('/api/years', (c) => c.json(lib.assets.years()))

  app.get('/api/assets/:id', (c) => {
    const d = lib.assets.detail(idParam(c))
    return d ? c.json(d) : c.json({ error: 'not found' }, 404)
  })
  app.patch('/api/assets', async (c) => {
    const body = z
      .object({ ids: z.array(z.number().int()).min(1).max(100000), favorite: z.boolean().optional(), trashed: z.boolean().optional() })
      .parse(await c.req.json())
    if (body.favorite !== undefined) lib.setFavorite(body.ids, body.favorite)
    if (body.trashed !== undefined) lib.setTrashed(body.ids, body.trashed)
    return c.json({ ok: true })
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
      return sendFile(c, join(dir, 'index.html'))
    })
  }

  return app
}
