import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Library } from '@core/library'
import { paginate, proposeMemories, select } from '@core/organize/memories'

const LIB = join(process.cwd(), '.devdata/library')

describe('memory composition', () => {
  it('spreads picks over time and prefers quality', () => {
    const cands = Array.from({ length: 40 }, (_, i) => ({
      id: i + 1, takenAt: Math.floor(i / 4) * 3600000 + (i % 4) * 60000, day: '2023-01-01', kind: 'photo', quality: i % 4 === 0 ? 0.9 : 0.4,
      favorite: false, faces: 0, screenshot: false, phash: null, clip: null, ratio: 1.5
    }))
    const chosen = select(cands, 10)
    expect(chosen.length).toBe(10)
    expect(chosen.filter((c) => c.quality > 0.8).length).toBeGreaterThanOrEqual(8)
    expect(new Set(chosen.map((c) => Math.floor(c.takenAt / 3600000))).size).toBeGreaterThanOrEqual(8)
  })

  it('paginates into an editorial sequence covering every photo once', () => {
    const items = Array.from({ length: 23 }, (_, i) => ({ id: i + 1, ratio: i % 3 === 0 ? 0.75 : 1.5, score: (i * 7) % 10 / 10 }))
    const pages = paginate(items, 'Titre', 'Sous-titre')
    expect(pages[0]!.type).toBe('cover')
    expect(pages[1]!.type).toBe('title')
    expect(pages[pages.length - 1]!.type).toBe('end')
    const body = pages.slice(2, -1).flatMap((p) => ('ids' in p ? p.ids : []))
    expect([...body].sort((a, b) => a - b)).toEqual(items.map((i) => i.id))
    expect(new Set(pages.slice(2, -1).map((p) => p.type)).size).toBeGreaterThanOrEqual(3)
  })
})

describe.runIf(existsSync(LIB))('memories on the fixture library', () => {
  let dataDir: string
  let lib: Library
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-mem-'))
    lib = new Library({ dataDir, autoIndex: false, watch: false, resourcesDir: join(process.cwd(), 'resources') })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
    await lib.ensureMemories(true)
  }, 240000)
  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  it('proposes yearly memories with a cover, a theme and pages', () => {
    const drafts = proposeMemories(lib.db, new Date(2026, 0, 15))
    expect(drafts.some((d) => d.kind === 'year')).toBe(true)
    const list = lib.memories()
    expect(list.length).toBeGreaterThan(0)
    const m = lib.memory(list[0]!.id)!
    expect(m.assetIds.length).toBeGreaterThanOrEqual(10)
    expect(m.theme.accent).toMatch(/^#[0-9a-f]{6}$/)
    expect(m.pages[0]!.type).toBe('cover')
    expect(m.tiles.length).toBe(m.assetIds.length)
  })

  it('groups the timeline by moments with titles', () => {
    const buckets = lib.assets.buckets({ filter: 'all', group: 'moments' })
    expect(buckets.length).toBeGreaterThan(10)
    expect(buckets[0]!.title).toBeTruthy()
    expect(buckets.reduce((a, b) => a + b.count, 0)).toBe(lib.assets.counts().all)
    const page = lib.assets.page({ filter: 'all', group: 'moments' }, 0, 5)
    expect(page.length).toBe(5)
    expect(lib.assets.indexOf({ filter: 'all', group: 'moments' }, page[3]!.id)).toBe(3)
  })

  it('saves a memory as an album and keeps edits', () => {
    const m = lib.memories()[0]!
    const albumId = lib.saveMemoryAsAlbum(m.id)
    expect(lib.albums.get(albumId)!.count).toBe(m.count)
    lib.updateMemory(m.id, { title: 'Mon souvenir', pinned: true })
    expect(lib.memories()[0]!.title).toBe('Mon souvenir')
  })

  it('retranslates generated memory titles but keeps renamed ones', async () => {
    const renamed = lib.memories().find((m) => m.title === 'Mon souvenir')!
    const year = lib.memories().find((m) => m.kind === 'year' && m.id !== renamed.id)!
    expect(year.title).toMatch(/en images$/)
    lib.setLocalePref('en', 'en-US')
    await lib.ensureMemories(true)
    expect(lib.memories().find((m) => m.id === year.id)!.title).toMatch(/in pictures$/)
    expect(lib.memories().find((m) => m.id === renamed.id)!.title).toBe('Mon souvenir')
    lib.setLocalePref('fr', 'fr-FR')
    await lib.ensureMemories(true)
    expect(lib.memories().find((m) => m.id === year.id)!.title).toMatch(/en images$/)
  })
})
