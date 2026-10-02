import { afterEach, describe, expect, it } from 'vitest'
import { mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { openDb } from '@core/db'
import { migrations } from '@core/db/migrations'
import { Library } from '@core/library'
import {
  createHousehold, createMember, defaultAppDataDir, HOUSEHOLD_APP, osName, presetFile, readHousehold, readPreset, writeJsonAtomic
} from '@core/household'
import { createGuestApp } from '../src/server/guest'

const dirs: string[] = []
function temp(): string {
  const d = mkdtempSync(join(tmpdir(), 'myphotos-foyer-'))
  dirs.push(d)
  return d
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true })
})

const json = (file: string): Record<string, unknown> => JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>

describe('household folder', () => {
  it('reads an empty folder as no household', async () => {
    expect(await readHousehold(temp())).toMatchObject({ exists: false, name: null, members: [] })
  })

  it('creates the household once, then members', async () => {
    const d = temp()
    await createHousehold(d, ' Les Dagues Hautes ')
    await expect(createHousehold(d, 'encore')).rejects.toThrow()
    const f = json(join(d, 'foyer.json'))
    expect(f).toMatchObject({ format: 1, name: 'Les Dagues Hautes' })
    expect(f.foyer_id).toMatch(/^[0-9a-f-]{36}$/)
    expect(f).not.toHaveProperty('members') // the member list lives in membres/, never in a file everyone rewrites
    const a = await createMember(d, 'Alex', 'fleur')
    const b = await createMember(d, 'Sam', 'lampe')
    await expect(createMember(d, '  ', 'globe')).rejects.toThrow()
    await expect(createMember(d, 'Zoé', '../x')).rejects.toThrow()
    const p = json(join(d, 'membres', a.member_id, 'profil.json'))
    expect(p).toMatchObject({ member_id: a.member_id, name: 'Alex', objet: 'fleur' })
    expect(p.created_at).toMatch(/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\dZ$/)
    const h = await readHousehold(d)
    expect(h.exists).toBe(true)
    expect(h.name).toBe('Les Dagues Hautes')
    expect(h.members.map((m) => m.id).sort()).toEqual([a.member_id, b.member_id].sort())
    expect(h.members.find((m) => m.name === 'Sam')?.objet).toBe('lampe')
  })

  it('ignores macOS doubles, .DS_Store, archived members and broken profiles', async () => {
    const d = temp()
    await createHousehold(d, 'Foyer')
    const a = await createMember(d, 'Alex', 'fleur')
    const gone = await createMember(d, 'Parti', 'globe')
    await writeJsonAtomic(join(d, 'membres', gone.member_id, 'profil.json'), { ...gone, archived_at: '2026-10-02T00:00:00Z' })
    writeFileSync(join(d, 'membres', '.DS_Store'), 'junk')
    writeFileSync(join(d, 'membres', `._${a.member_id}`), 'junk')
    mkdirSync(join(d, 'membres', `._${a.member_id}x`))
    writeFileSync(join(d, 'membres', `._${a.member_id}x`, 'profil.json'), JSON.stringify({ ...a, member_id: `._${a.member_id}x`, name: 'Double' }))
    writeFileSync(join(d, 'membres', a.member_id, '._profil.json'), 'junk')
    mkdirSync(join(d, 'membres', 'cassé'))
    writeFileSync(join(d, 'membres', 'cassé', 'profil.json'), '{ not json')
    writeFileSync(join(d, '._foyer.json'), 'junk')
    const h = await readHousehold(d)
    expect(h.members).toEqual([{ id: a.member_id, name: 'Alex', objet: 'fleur' }])
  })

  it('reads the launcher pre-setting, never requires it', async () => {
    const d = temp()
    expect(await readPreset(join(d, 'absent.json'))).toBeNull()
    const f = presetFile(join(d, 'appData'))
    expect(f).toBe(join(d, 'appData', 'LesDaguesHautes', 'foyer.local.json'))
    await writeJsonAtomic(f, { format: 1, foyer_dir: '/x/Foyer', member_id: 'm1', written_at: '2026-10-02T00:00:00Z' })
    expect(await readPreset(f)).toEqual({ dir: '/x/Foyer', memberId: 'm1' })
    await writeJsonAtomic(f, { format: 2, foyer_dir: '/x', member_id: 'm1' })
    expect(await readPreset(f)).toBeNull()
    expect(defaultAppDataDir('darwin', {}, '/Users/a')).toBe(join('/Users/a', 'Library', 'Application Support'))
    expect(defaultAppDataDir('win32', { APPDATA: 'C:\\Users\\a\\AppData\\Roaming' }, 'C:\\Users\\a')).toBe('C:\\Users\\a\\AppData\\Roaming')
  })
})

describe('joining the household', () => {
  function setup(preset?: string): { lib: Library; foyer: string } {
    const root = temp()
    const lib = new Library({ dataDir: join(root, 'data'), autoIndex: false, watch: false, householdPreset: preset ?? null })
    return { lib, foyer: join(root, 'Foyer') }
  }

  it('works without a household, exactly as before', async () => {
    const { lib } = setup(join(temp(), 'nothing', 'foyer.local.json'))
    const s = await lib.household.status()
    expect(s).toMatchObject({ joined: false, dir: null, me: null, preset: null })
    expect(lib.household.members()).toEqual([])
    lib.close()
  })

  it('proposes the launcher member, writes the device file and local state, claims existing albums', async () => {
    const root = temp()
    const foyer = join(root, 'Foyer')
    mkdirSync(foyer)
    await createHousehold(foyer, 'Foyer')
    const alex = await createMember(foyer, 'Alex', 'theiere')
    const preset = presetFile(join(root, 'appData'))
    await writeJsonAtomic(preset, { format: 1, foyer_dir: foyer, member_id: alex.member_id, written_at: '2026-10-02T00:00:00Z' })
    const lib = new Library({ dataDir: join(root, 'data'), autoIndex: false, watch: false, householdPreset: preset })
    lib.setSetting('owner_name', 'Dimitri')
    const before = lib.albums.create('Vacances', 'manual', null)
    expect(before.ownerId).toBeNull()

    const s0 = await lib.household.status()
    expect(s0.joined).toBe(false)
    expect(s0.preset).toEqual({ dir: foyer, member: { id: alex.member_id, name: 'Alex', objet: 'theiere' } })

    const s = await lib.household.join(foyer, alex.member_id)
    expect(s).toMatchObject({ joined: true, dir: foyer, name: 'Foyer', me: { id: alex.member_id, name: 'Alex' }, reachable: true, preset: null })
    const device = lib.setting('device_id')!
    expect(device).toMatch(/^[0-9a-f-]{36}$/)
    expect(lib.setting('member_id')).toBe(alex.member_id)
    expect(lib.setting('foyer_dir')).toBe(foyer)
    expect(lib.ownerName).toBe('Alex') // owner_name follows the profile
    const app = json(join(foyer, 'appareils', `${device}.json`))
    expect(app).toMatchObject({ device_id: device, member_id: alex.member_id, app: HOUSEHOLD_APP, os: osName() })
    expect(app.app).toBe('myphotos')
    // nothing of the library goes into the household folder
    expect(readdirSync(foyer).sort()).toEqual(['appareils', 'foyer.json', 'membres'])

    // existing albums become the member's, perso; new ones are born theirs
    expect(lib.albums.get(before.id)).toMatchObject({ ownerId: alex.member_id, visibility: 'perso', sharedWith: [] })
    expect(lib.albums.create('Noël', 'manual', null).ownerId).toBe(alex.member_id)

    // a rename in the profile reaches owner_name at the next read
    await writeJsonAtomic(join(foyer, 'membres', alex.member_id, 'profil.json'), { ...alex, name: 'Alexandre', updated_at: '2026-10-03T00:00:00Z' })
    await lib.household.refresh()
    expect(lib.ownerName).toBe('Alexandre')

    // leaving keeps the device; joining again as the same member reuses it, another member gets a new one
    lib.household.leave()
    expect((await lib.household.status()).joined).toBe(false)
    await lib.household.join(foyer, alex.member_id)
    expect(lib.setting('device_id')).toBe(device)
    const sam = await createMember(foyer, 'Sam', 'pavillon')
    await lib.household.join(foyer, sam.member_id)
    expect(lib.setting('device_id')).not.toBe(device)
    lib.close()
  })

  it('refuses a folder without household or an unknown member, and survives an unreachable folder', async () => {
    const { lib, foyer } = setup()
    mkdirSync(foyer)
    await expect(lib.household.join(foyer, 'x')).rejects.toThrow()
    await createHousehold(foyer, 'Foyer')
    await expect(lib.household.join(foyer, 'x')).rejects.toThrow()
    const m = await createMember(foyer, 'Alex', 'fleur')
    await lib.household.join(foyer, m.member_id)
    rmSync(foyer, { recursive: true })
    const s = await lib.household.status()
    expect(s).toMatchObject({ joined: true, reachable: false, me: { name: 'Alex' } })
    expect(s.seenAt).toBeGreaterThan(0)
    lib.close()
  })
})

describe('migration 18', () => {
  it('adds owner and visibility to albums and member authors to comments and likes, keeping the data', () => {
    const file = join(temp(), 'library.db')
    const old = new DatabaseSync(file)
    for (const m of migrations.slice(0, 17)) old.exec(m)
    old.exec('PRAGMA user_version = 17')
    old.exec("INSERT INTO albums (id, name, kind, created_at, updated_at) VALUES (1, 'Été', 'manual', 1, 1)")
    old.exec("INSERT INTO share_comments (album_id, asset_id, author, text, created_at) VALUES (1, NULL, 'Mamie', 'Belles photos', 2)")
    old.exec("INSERT INTO share_likes (album_id, asset_id, author, created_at) VALUES (1, 5, 'Mamie', 3)")
    old.close()

    const db = openDb(file)
    expect((db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version).toBe(18)
    expect(db.prepare('SELECT name, owner_id, visibility, shared_with FROM albums').get()).toEqual({ name: 'Été', owner_id: null, visibility: 'perso', shared_with: '[]' })
    expect(db.prepare('SELECT author, text, author_member_id FROM share_comments').get()).toEqual({ author: 'Mamie', text: 'Belles photos', author_member_id: null })
    expect(db.prepare('SELECT author, author_member_id FROM share_likes').get()).toEqual({ author: 'Mamie', author_member_id: null })
    db.close()
  })
})

describe('guests who are household members', () => {
  it('lets a member say « Je suis… » and signs comments and likes with their member_id', async () => {
    const root = temp()
    const foyer = join(root, 'Foyer')
    mkdirSync(foyer)
    await createHousehold(foyer, 'Foyer')
    const me = await createMember(foyer, 'Dimitri', 'globe')
    const sam = await createMember(foyer, 'Sam', 'lampe')
    const lib = new Library({ dataDir: join(root, 'data'), autoIndex: false, watch: false })
    const app = createGuestApp(lib, { ownerName: () => lib.ownerName })
    // one asset row, enough for likes (the guest API only checks album membership)
    lib.db.exec(`INSERT INTO sources (id, path, added_at) VALUES (1, '${join(root, 'photos')}', 0)`)
    lib.db.exec(`INSERT INTO assets (id, source_id, path, rel_dir, name, stem, ext, kind, size, mtime, taken_at, day, added_at)
      VALUES (1, 1, '${join(root, 'photos', 'a.jpg')}', '', 'a.jpg', 'a', 'jpg', 'photo', 1, 0, 0, '2026-10-02', 0)`)
    const albumId = lib.albums.create('Vacances', 'manual', null, [1]).id
    const token = lib.shares.create(albumId, { canAdd: false }).token
    const post = (path: string, body: unknown): Promise<Response> =>
      Promise.resolve(app.request(`/g/api/${token}${path}`, { method: 'POST', body: JSON.stringify(body), headers: { 'content-type': 'application/json' } }))

    // no household: plain guests only
    expect(((await (await app.request(`/g/api/${token}`)).json()) as { members: unknown[] }).members).toEqual([])

    await lib.household.join(foyer, me.member_id)
    const info = (await (await app.request(`/g/api/${token}`)).json()) as { owner: string; members: Array<{ id: string; name: string; objet: string }> }
    expect(info.owner).toBe('Dimitri')
    expect(info.members).toEqual(expect.arrayContaining([{ id: sam.member_id, name: 'Sam', objet: 'lampe' }, { id: me.member_id, name: 'Dimitri', objet: 'globe' }]))

    // a member: the name comes from the profile, whatever the page sent
    const c1 = (await (await post('/comments', { assetId: 1, author: 'quelqu’un', memberId: sam.member_id, text: 'Super' })).json()) as Record<string, unknown>
    expect(c1).toMatchObject({ author: 'Sam', memberId: sam.member_id, text: 'Super' })
    // a plain guest keeps the free-text name
    const c2 = (await (await post('/comments', { assetId: 1, author: 'Mamie', text: 'Bravo' })).json()) as Record<string, unknown>
    expect(c2).toMatchObject({ author: 'Mamie', memberId: null })
    // a member_id that is not in the household is refused
    expect((await post('/comments', { assetId: 1, author: 'X', memberId: 'pas-un-membre', text: 'Hop' })).status).toBe(400)
    expect(lib.db.prepare('SELECT author, author_member_id FROM share_comments ORDER BY id').all()).toEqual([
      { author: 'Sam', author_member_id: sam.member_id },
      { author: 'Mamie', author_member_id: null }
    ])

    expect(await (await post('/like/1', { author: 'Sam', memberId: sam.member_id })).json()).toEqual({ liked: true })
    expect(await (await post('/like/1', { author: 'Mamie' })).json()).toEqual({ liked: true })
    const items = (await (await app.request(`/g/api/${token}/items`)).json()) as Array<{ likes: string[]; likeMembers: string[] }>
    expect(items[0]!.likes.sort()).toEqual(['Mamie', 'Sam'])
    expect(items[0]!.likeMembers).toEqual([sam.member_id])
    // the member's like follows their member_id
    expect(await (await post('/like/1', { author: 'Sam renommé', memberId: sam.member_id })).json()).toEqual({ liked: false })
    lib.close()
  })
})
