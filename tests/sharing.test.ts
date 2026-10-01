import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { cpSync, existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'
import { createGuestApp } from '../src/server/guest'

const LIB = join(process.cwd(), '.devdata/library')

describe.runIf(existsSync(LIB))('family sharing', () => {
  let dir: string
  let lib: Library
  let app: ReturnType<typeof createGuestApp>
  let albumId: number
  let other: number
  let token: string
  let pinToken: string

  beforeAll(async () => {
    dir = mkdtempSync(join(tmpdir(), 'myphotos-share-'))
    cpSync(LIB, join(dir, 'library'), { recursive: true })
    lib = new Library({ dataDir: join(dir, 'data'), autoIndex: false, watch: false })
    await lib.addSource(join(dir, 'library'))
    await lib.rescanAll()
    await lib.kickIndexer()
    const page = lib.assets.page({ filter: 'all' }, 0, 20)
    albumId = lib.albums.create('Vacances', 'manual', null, page.slice(0, 6).map((t) => t.id)).id
    other = page[10]!.id
    token = lib.shares.create(albumId, { canAdd: true }).token
    pinToken = lib.shares.create(albumId, { canAdd: false, pin: '1234' }).token
    app = createGuestApp(lib, { ownerName: () => 'Dimitri' })
  }, 240000)

  afterAll(() => {
    lib.close()
    rmSync(dir, { recursive: true, force: true })
  })

  const get = (path: string, init?: RequestInit): Promise<Response> => Promise.resolve(app.request(path, init))

  it('shows only the shared album', async () => {
    const info = await (await get(`/g/api/${token}`)).json()
    expect(info).toMatchObject({ name: 'Vacances', count: 6, canAdd: true, owner: 'Dimitri', locked: false })
    const items = (await (await get(`/g/api/${token}/items`)).json()) as Array<{ id: number }>
    expect(items.length).toBe(6)
    expect((await get(`/g/api/${token}/thumb/${items[0]!.id}`)).status).toBe(200)
    // an asset outside the album is not reachable, nor is the private API
    expect((await get(`/g/api/${token}/thumb/${other}`)).status).toBe(404)
    expect((await get(`/g/api/${token}/original/${other}`)).status).toBe(404)
    expect((await get('/api/state')).status).toBe(404)
    expect((await get('/g/api/nope')).status).toBe(404)
  })

  it('requires the PIN when set', async () => {
    expect(((await (await get(`/g/api/${pinToken}`)).json()) as { locked: boolean }).locked).toBe(true)
    expect((await get(`/g/api/${pinToken}/items`)).status).toBe(401)
    expect((await get(`/g/api/${pinToken}/unlock`, { method: 'POST', body: JSON.stringify({ pin: '0000' }), headers: { 'content-type': 'application/json' } })).status).toBe(403)
    const ok = await get(`/g/api/${pinToken}/unlock`, { method: 'POST', body: JSON.stringify({ pin: '1234' }), headers: { 'content-type': 'application/json' } })
    expect(ok.status).toBe(200)
    const cookie = ok.headers.get('set-cookie')!.split(';')[0]!
    expect((await get(`/g/api/${pinToken}/items`, { headers: { cookie } })).status).toBe(200)
    // read-only link refuses uploads
    const fd = new FormData()
    fd.append('f', new Blob([readFileSync(join(LIB, 'Divers/IMG_ROT6.JPG'))]), 'x.jpg')
    expect((await get(`/g/api/${pinToken}/upload?author=Mamie`, { method: 'POST', body: fd, headers: { cookie } })).status).toBe(403)
  })

  it('accepts uploads into Partagés and adds them to the album', async () => {
    const fd = new FormData()
    fd.append('files', new Blob([readFileSync(join(LIB, 'Divers/IMG_ROT6.JPG'))]), 'photo de mamie.jpg')
    fd.append('files', new Blob(['not an image']), 'virus.exe')
    const r = await get(`/g/api/${token}/upload?author=Mamie`, { method: 'POST', body: fd })
    const body = (await r.json()) as { added: number; rejected: string[] }
    expect(body).toEqual({ added: 1, rejected: ['virus.exe'] })
    expect(existsSync(join(dir, 'library', 'Partagés', 'Vacances', 'photo de mamie.jpg'))).toBe(true)
    expect(lib.albums.get(albumId)!.count).toBe(7)
    expect(lib.shares.activity()[0]).toMatchObject({ albumId, uploads: 1 })
  })

  it('stores comments and likes, and zips the album', async () => {
    const items = (await (await get(`/g/api/${token}/items`)).json()) as Array<{ id: number }>
    const c = await get(`/g/api/${token}/comments`, { method: 'POST', body: JSON.stringify({ assetId: items[0]!.id, author: 'Léa', text: 'Trop belle !' }), headers: { 'content-type': 'application/json' } })
    expect(((await c.json()) as { text: string }).text).toBe('Trop belle !')
    const l = await get(`/g/api/${token}/like/${items[0]!.id}`, { method: 'POST', body: JSON.stringify({ author: 'Léa' }), headers: { 'content-type': 'application/json' } })
    expect(((await l.json()) as { liked: boolean }).liked).toBe(true)
    const zip = await get(`/g/api/${token}/zip`)
    expect(zip.headers.get('content-type')).toBe('application/zip')
    const buf = Buffer.from(await zip.arrayBuffer())
    expect(buf.subarray(0, 2).toString()).toBe('PK')
    expect(buf.length).toBeGreaterThan(50000)
  })

  it('stops working once revoked', async () => {
    const link = lib.shares.forAlbum(albumId).find((s) => s.token === token)!
    lib.shares.revoke(link.id)
    expect((await get(`/g/api/${token}`)).status).toBe(404)
  })
})
