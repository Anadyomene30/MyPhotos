import { createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { basename, join, normalize, sep } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { Hono, type Context } from 'hono'
import { getCookie, setCookie } from 'hono/cookie'
import busboy from 'busboy'
import yazl from 'yazl'
import { z } from 'zod'
import type { Library } from '@core/library'
import { extOf, kindOf } from '@core/media/kinds'
import { sanitize } from '@core/export/naming'
import { sendFile } from './files'
import type { SharedAlbumInfo } from '@shared/types'
import { t } from '@shared/i18n'

const MAX_UPLOAD = 4 * 1024 ** 3

/**
 * Guest server for family members on the local network. It only exposes what a share link grants:
 * one album, read access, and optionally adding photos. No other route of the library is reachable.
 */
export function createGuestApp(lib: Library, opts: { rendererDir?: string; ownerName: () => string }): Hono {
  const app = new Hono()

  type Share = NonNullable<ReturnType<typeof lib.shares.resolve>>
  const unlocked = (c: Context, s: Share): boolean => !s.pinHash || getCookie(c, `mp_${s.id}`) === lib.shares.unlockCookie(s.token, s.pinHash)

  /** Resolve the share from the URL; 404 for unknown/expired tokens, 401 when a PIN is still needed. */
  const guard = (c: Context): { share: Share } | Response => {
    const s = lib.shares.resolve(c.req.param('token') ?? '')
    if (!s) return c.json({ error: t('Ce lien de partage n’existe plus.') }, 404)
    if (!unlocked(c, s)) return c.json({ error: 'locked' }, 401)
    return { share: s }
  }
  /**
   * Who signs a comment, a like or an upload: a household member by their member_id (their name comes from their
   * profile), or a plain guest by the free name they typed. Null for a member_id that is not in the household.
   */
  const signer = (author: string, memberId: string | null | undefined): { author: string; memberId: string | null } | null => {
    if (!memberId) return { author: author.trim(), memberId: null }
    const m = lib.household.member(memberId)
    return m ? { author: m.name.slice(0, 40), memberId: m.id } : null
  }
  const albumIds = (s: Share): number[] => lib.assets.ids({ filter: 'all', album: s.albumId })
  const inAlbum = (s: Share, id: number): boolean => albumIds(s).includes(id)

  app.use('*', async (c, next) => {
    c.header('X-Content-Type-Options', 'nosniff')
    c.header('Referrer-Policy', 'no-referrer')
    await next()
  })

  app.get('/g/api/:token', (c) => {
    const s = lib.shares.resolve(c.req.param('token'))
    if (!s) return c.json({ error: t('Ce lien de partage n’existe plus.') }, 404)
    const album = lib.albums.get(s.albumId)!
    const locked = !unlocked(c, s)
    if (!locked) lib.shares.touch(s.id)
    const info: SharedAlbumInfo = {
      name: album.name, count: locked ? 0 : album.count, canAdd: s.canAdd && album.kind === 'manual', owner: opts.ownerName(), coverId: locked ? null : album.coverId, locked,
      // spec/01 § 11: a guest who is a household member can say « Je suis… »
      members: locked ? [] : lib.household.members()
    }
    return c.json(info)
  })

  app.post('/g/api/:token/unlock', async (c) => {
    const s = lib.shares.resolve(c.req.param('token'))
    if (!s) return c.json({ error: t('Ce lien de partage n’existe plus.') }, 404)
    const { pin } = z.object({ pin: z.string().max(40) }).parse(await c.req.json())
    await new Promise((r) => setTimeout(r, 400)) // slow down guessing
    if (!s.pinHash || !lib.shares.checkPin(s.token, s.pinHash, pin)) return c.json({ error: t('Code incorrect') }, 403)
    setCookie(c, `mp_${s.id}`, lib.shares.unlockCookie(s.token, s.pinHash), { httpOnly: true, sameSite: 'Lax', path: '/', maxAge: 60 * 60 * 24 * 90 })
    return c.json({ ok: true })
  })

  app.get('/g/api/:token/items', (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const offset = Math.max(0, parseInt(c.req.query('offset') ?? '0', 10) || 0)
    const limit = Math.min(500, Math.max(1, parseInt(c.req.query('limit') ?? '200', 10) || 200))
    const likes = lib.shares.likes(g.share.albumId)
    const tiles = lib.assets.page({ filter: 'all', album: g.share.albumId }, offset, limit).map((t) => {
      const l = likes.get(t.id) ?? []
      return { ...t, likes: l.map((x) => x.author), likeMembers: l.flatMap((x) => (x.memberId ? [x.memberId] : [])) }
    })
    return c.json(tiles)
  })

  const media = (size: 'grid' | 'preview') => async (c: Context): Promise<Response> => {
    const g = guard(c)
    if (g instanceof Response) return g
    const id = parseInt(c.req.param('id') ?? '', 10)
    if (!inAlbum(g.share, id)) return c.body(null, 404)
    const d = lib.assets.detail(id)
    if (!d) return c.body(null, 404)
    if (size === 'preview' && d.kind === 'photo' && d.webNative) return sendFile(c, d.path, { cache: 'private, max-age=86400' })
    const file = await lib.thumbnail(id, size)
    return file ? sendFile(c, file, { type: 'image/webp', cache: 'private, max-age=86400' }) : c.body(null, 404)
  }
  app.get('/g/api/:token/thumb/:id', media('grid'))
  app.get('/g/api/:token/preview/:id', media('preview'))
  app.get('/g/api/:token/original/:id', async (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const id = parseInt(c.req.param('id'), 10)
    if (!inAlbum(g.share, id)) return c.body(null, 404)
    const d = lib.assets.detail(id)!
    return sendFile(c, d.path, { download: c.req.query('download') ? d.name : undefined })
  })

  /** Whole album as a ZIP, streamed (no compression: photos are already compressed). */
  app.get('/g/api/:token/zip', (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const album = lib.albums.get(g.share.albumId)!
    const zip = new yazl.ZipFile()
    const used = new Set<string>()
    for (const id of albumIds(g.share)) {
      const d = lib.assets.detail(id)
      if (!d || !existsSync(d.path)) continue
      let name = d.name
      for (let i = 2; used.has(name.toLowerCase()); i++) name = d.name.replace(/(\.[^.]+)?$/, ` (${i})$1`)
      used.add(name.toLowerCase())
      zip.addFile(d.path, name, { compress: false })
    }
    zip.end()
    const filename = `${sanitize(album.name)}.zip`
    return new Response(Readable.toWeb(zip.outputStream as Readable) as ReadableStream, {
      headers: { 'Content-Type': 'application/zip', 'Content-Disposition': `attachment; filename*=UTF-8''${encodeURIComponent(filename)}` }
    })
  })

  app.get('/g/api/:token/comments', (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const asset = c.req.query('asset')
    return c.json(lib.shares.comments(g.share.albumId, asset ? parseInt(asset, 10) : undefined))
  })
  app.post('/g/api/:token/comments', async (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const body = z.object({ assetId: z.number().int().nullable(), author: z.string().min(1).max(40), text: z.string().min(1).max(1000), memberId: z.string().max(64).nullish() }).parse(await c.req.json())
    if (body.assetId !== null && !inAlbum(g.share, body.assetId)) return c.body(null, 404)
    const who = signer(body.author, body.memberId)
    if (!who) return c.json({ error: t('Ce membre n’est pas dans le foyer.') }, 400)
    const cm = lib.shares.addComment(g.share.albumId, body.assetId, who.author, body.text.trim(), who.memberId)
    lib.shareActivity(g.share.albumId, 'comment', who.author)
    return c.json(cm)
  })
  app.post('/g/api/:token/like/:id', async (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const id = parseInt(c.req.param('id'), 10)
    if (!inAlbum(g.share, id)) return c.body(null, 404)
    const body = z.object({ author: z.string().min(1).max(40), memberId: z.string().max(64).nullish() }).parse(await c.req.json())
    const who = signer(body.author, body.memberId)
    if (!who) return c.json({ error: t('Ce membre n’est pas dans le foyer.') }, 400)
    const liked = lib.shares.toggleLike(g.share.albumId, id, who.author, who.memberId)
    if (liked) lib.shareActivity(g.share.albumId, 'like', who.author)
    return c.json({ liked })
  })

  /** Streamed multipart upload into <library>/Partagés/<album>/, the only folder MyPhotos writes into. */
  app.post('/g/api/:token/upload', async (c) => {
    const g = guard(c)
    if (g instanceof Response) return g
    const album = lib.albums.get(g.share.albumId)!
    if (!g.share.canAdd || album.kind !== 'manual') return c.json({ error: t('Ce lien ne permet pas d’ajouter des photos') }, 403)
    const author = (signer(c.req.query('author') ?? t('Invité'), c.req.query('member'))?.author ?? t('Invité')).slice(0, 40)
    const dir = lib.sharedUploadDir(album.name)
    if (!dir) return c.json({ error: t('Aucun dossier de photothèque disponible') }, 500)
    await mkdir(dir, { recursive: true })
    const saved: string[] = []
    const rejected: string[] = []
    const headers: Record<string, string> = {}
    c.req.raw.headers.forEach((v, k) => (headers[k] = v))
    await new Promise<void>((resolve, reject) => {
      const bb = busboy({ headers, limits: { fileSize: MAX_UPLOAD, files: 500 } })
      const writes: Promise<void>[] = []
      bb.on('file', (_field, stream, info) => {
        const original = basename(info.filename || 'photo.jpg')
        const ext = extOf(original)
        if (!kindOf(ext)) {
          rejected.push(original)
          stream.resume()
          return
        }
        const stem = sanitize(original.replace(/\.[^.]+$/, '')) || 'photo'
        let target = join(dir, `${stem}.${ext}`)
        for (let i = 2; existsSync(target) || saved.includes(target); i++) target = join(dir, `${stem} (${i}).${ext}`)
        const n = normalize(target)
        if (!n.startsWith(normalize(dir) + sep)) {
          stream.resume()
          return
        }
        saved.push(n)
        const tmp = `${n}.upload`
        writes.push(
          pipeline(stream, createWriteStream(tmp)).then(async () => {
            if ((stream as unknown as { truncated?: boolean }).truncated) {
              await rm(tmp, { force: true })
              saved.splice(saved.indexOf(n), 1)
              rejected.push(original)
              return
            }
            await rename(tmp, n)
          })
        )
      })
      bb.on('error', reject)
      bb.on('close', () => void Promise.all(writes).then(() => resolve(), reject))
      if (!c.req.raw.body) return reject(new Error('empty body'))
      Readable.fromWeb(c.req.raw.body as never).pipe(bb)
    })
    const ok: string[] = []
    for (const f of saved) if (await stat(f).then(() => true, () => false)) ok.push(f)
    await lib.addSharedUploads(g.share.albumId, ok, author)
    return c.json({ added: ok.length, rejected })
  })

  // web page (same bundle as the app, guest mode)
  const dir = opts.rendererDir
  if (dir && existsSync(join(dir, 'index.html'))) {
    app.get('*', async (c) => {
      const url = new URL(c.req.url)
      let rel = normalize(decodeURIComponent(url.pathname)).replace(/^([/\\])+/, '')
      // the bundle uses relative asset URLs: /s/<token>/../assets/x.js resolves to /s/assets/x.js
      const m = /(^|\/)assets\/([^/]+)$/.exec(rel.replace(/\\/g, '/'))
      if (m) rel = `assets/${m[2]}`
      if (rel.startsWith('assets') || rel === 'favicon.ico') {
        const file = join(dir, rel)
        if (file.startsWith(dir + sep) && existsSync(file)) return sendFile(c, file, { cache: 'public, max-age=31536000, immutable' })
        return c.body(null, 404)
      }
      if (!rel.startsWith('s/')) return c.text('MyPhotos', 404)
      const res = await sendFile(c, join(dir, 'index.html'))
      res.headers.set('Content-Security-Policy', "default-src 'self'; img-src 'self' data: blob:; media-src 'self' blob:; style-src 'self' 'unsafe-inline'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; frame-ancestors 'none'")
      return res
    })
  }
  return app
}
