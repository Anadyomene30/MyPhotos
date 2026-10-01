import { describe, expect, it } from 'vitest'
import { copyFileSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { openDb } from '@core/db'
import { applyChanges, isShortcutHeader, scanSource } from '@core/scan/scanner'
import { bookmarkTargetPath } from '@core/scan/bookmark'
import { Library } from '@core/library'

/** Builds bookmark data the way macOS writes Finder aliases: header, items, then a table of contents. */
function makeBookmark(target: string): Buffer {
  const HDR = 0x38
  const body: number[] = [0, 0, 0, 0] // TOC offset, patched below
  const u32 = (v: number): number[] => [v & 255, (v >> 8) & 255, (v >> 16) & 255, (v >>> 24) & 255]
  const item = (type: number, data: number[]): number => {
    const at = body.length
    body.push(...u32(data.length), ...u32(type), ...data)
    while (body.length % 4) body.push(0)
    return at
  }
  const parts = target.split('/').filter(Boolean).map((p) => item(0x0101, [...Buffer.from(p, 'utf8')]))
  const arr = item(0x0601, parts.flatMap(u32))
  const toc = body.length
  body.push(...u32(12 + 8 + 12), ...u32(0xfffffffe), ...u32(1), ...u32(0), ...u32(1), ...u32(0x1004), ...u32(arr), ...u32(0))
  body.splice(0, 4, ...u32(toc))
  const head = Buffer.alloc(HDR)
  head.write('book', 0, 'latin1')
  head.write('mark', 8, 'latin1')
  head.writeUInt32LE(HDR, 16)
  return Buffer.concat([head, Buffer.from(body)])
}



describe('scanner', () => {
  it('ignores Finder aliases and Windows shortcuts named like photos', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'myphotos-scan-'))
    const alias = Buffer.alloc(1124)
    alias.write('book', 0, 'latin1')
    alias.write('mark', 8, 'latin1')
    writeFileSync(join(dir, 'IMG_2140.JPG'), alias)
    writeFileSync(join(dir, 'IMG_1144.HEIC'), Buffer.from([0x4c, 0, 0, 0, 0x01, 0x14, 0x02, 0, 0, 0, 0, 0]))
    // a small but real image stays
    const real = Buffer.from('/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/wAALCAABAAEBAREA/8QAFAABAAAAAAAAAAAAAAAAAAAACf/EABQQAQAAAAAAAAAAAAAAAAAAAAD/2gAIAQEAAD8AKp//2Q==', 'base64')
    writeFileSync(join(dir, 'tiny.jpg'), real)
    const db = openDb(':memory:')
    db.prepare('INSERT INTO sources (id, path, added_at) VALUES (1, ?, 0)').run(dir)
    const r = await scanSource(db, 1, dir)
    expect(r.total).toBe(1)
    expect((db.prepare('SELECT name FROM assets').all() as Array<{ name: string }>).map((x) => x.name)).toEqual(['tiny.jpg'])
    // the watcher path ignores them too
    copyFileSync(join(dir, 'IMG_2140.JPG'), join(dir, 'copy.jpg'))
    await applyChanges(db, 1, dir, [join(dir, 'copy.jpg')])
    expect((db.prepare('SELECT count(*) AS n FROM assets').get() as { n: number }).n).toBe(1)
    expect(isShortcutHeader(new Uint8Array(real.subarray(0, 16)))).toBe(false)
    db.close()
    rmSync(dir, { recursive: true, force: true })
  })
})

describe('alias folders', () => {
  it('reads the target of a bookmark', () => {
    expect(bookmarkTargetPath(makeBookmark('/Volumes/Disk/Photos/2019/IMG_1.JPG'))).toBe('/Volumes/Disk/Photos/2019/IMG_1.JPG')
    expect(bookmarkTargetPath(Buffer.from('not a bookmark at all, just some bytes to fill the header area....'))).toBeNull()
  })

  it('turns a folder of aliases into an album, once', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'myphotos-alias-'))
    const lib = join(dir, 'lib')
    const { mkdirSync } = await import('node:fs')
    mkdirSync(join(lib, '2019'), { recursive: true })
    mkdirSync(join(lib, 'Albums', 'Gavarnie'), { recursive: true })
    const src = join(process.cwd(), '.devdata/library/Divers/IMG_ROT6.JPG')
    copyFileSync(src, join(lib, '2019', 'a.jpg'))
    copyFileSync(src, join(lib, '2019', 'b.jpg'))
    writeFileSync(join(lib, 'Albums', 'Gavarnie', 'a.jpg'), makeBookmark(join(lib, '2019', 'a.jpg')))
    const l = new Library({ dataDir: join(dir, 'data'), autoIndex: false, watch: false })
    await l.addSource(lib)
    await l.rescanAll()
    const albums = l.albums.list()
    expect(albums.map((a) => [a.name, a.count])).toEqual([['Gavarnie', 1]])
    expect(l.assets.page({ filter: 'all' }, 0, 10).length).toBe(2)
    // a second alias appears later: added to the same album; a deleted album is not recreated
    writeFileSync(join(lib, 'Albums', 'Gavarnie', 'b.jpg'), makeBookmark(join(lib, '2019', 'b.jpg')))
    await l.rescanAll()
    expect(l.albums.list().map((a) => a.count)).toEqual([2])
    l.albums.remove(albums[0]!.id)
    writeFileSync(join(lib, 'Albums', 'Gavarnie', 'c.jpg'), makeBookmark(join(lib, '2019', 'a.jpg')))
    await l.rescanAll()
    expect(l.albums.list()).toEqual([])
    l.close()
    rmSync(dir, { recursive: true, force: true })
  })
})
