import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { Db, Row } from '../db'
import type { ShareComment, ShareLink } from '@shared/types'

const hashPin = (pin: string, token: string): string => createHash('sha256').update(`${token}:${pin}`).digest('hex')

export class ShareRepo {
  constructor(private db: Db) {}

  private toLink(r: Row): ShareLink {
    return {
      id: r.id as number, albumId: r.album_id as number, token: r.token as string, canAdd: r.can_add === 1, hasPin: Boolean(r.pin_hash),
      createdAt: r.created_at as number, expiresAt: r.expires_at as number | null, lastVisit: r.last_visit as number | null
    }
  }

  create(albumId: number, opts: { canAdd: boolean; pin?: string | null; expiresInDays?: number | null }): ShareLink {
    const token = randomBytes(18).toString('base64url')
    const pin = opts.pin?.trim() || null
    const expires = opts.expiresInDays ? Date.now() + opts.expiresInDays * 86400000 : null
    const r = this.db.prepare('INSERT INTO shares (album_id, token, can_add, pin_hash, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?)')
      .run(albumId, token, opts.canAdd ? 1 : 0, pin ? hashPin(pin, token) : null, Date.now(), expires)
    return this.toLink(this.db.prepare('SELECT * FROM shares WHERE id = ?').get(Number(r.lastInsertRowid)) as Row)
  }

  forAlbum(albumId: number): ShareLink[] {
    return (this.db.prepare('SELECT * FROM shares WHERE album_id = ? AND revoked = 0 ORDER BY created_at DESC').all(albumId) as Row[]).map((r) => this.toLink(r))
  }

  all(): ShareLink[] {
    return (this.db.prepare('SELECT * FROM shares WHERE revoked = 0 ORDER BY created_at DESC').all() as Row[]).map((r) => this.toLink(r))
  }

  revoke(id: number): void {
    this.db.prepare('UPDATE shares SET revoked = 1 WHERE id = ?').run(id)
  }

  /** Resolve a token to an active share (not revoked, not expired, album still exists). */
  resolve(token: string): (ShareLink & { pinHash: string | null }) | null {
    const r = this.db.prepare('SELECT s.* FROM shares s JOIN albums a ON a.id = s.album_id WHERE s.token = ? AND s.revoked = 0').get(token) as Row | undefined
    if (!r) return null
    if (r.expires_at && (r.expires_at as number) < Date.now()) return null
    return { ...this.toLink(r), pinHash: (r.pin_hash as string | null) ?? null }
  }

  checkPin(token: string, pinHash: string | null, pin: string): boolean {
    if (!pinHash) return true
    const a = Buffer.from(hashPin(pin, token))
    const b = Buffer.from(pinHash)
    return a.length === b.length && timingSafeEqual(a, b)
  }

  /** Opaque cookie value proving the PIN was entered for this token. */
  unlockCookie(token: string, pinHash: string): string {
    return createHash('sha256').update(`unlock:${token}:${pinHash}`).digest('base64url')
  }

  touch(id: number): void {
    this.db.prepare('UPDATE shares SET last_visit = ? WHERE id = ?').run(Date.now(), id)
  }

  comments(albumId: number, assetId?: number): ShareComment[] {
    const rows = (assetId === undefined
      ? this.db.prepare('SELECT * FROM share_comments WHERE album_id = ? ORDER BY created_at').all(albumId)
      : this.db.prepare('SELECT * FROM share_comments WHERE album_id = ? AND asset_id = ? ORDER BY created_at').all(albumId, assetId)) as Row[]
    return rows.map((r) => ({ id: r.id as number, assetId: r.asset_id as number | null, author: r.author as string, text: r.text as string, createdAt: r.created_at as number }))
  }

  addComment(albumId: number, assetId: number | null, author: string, text: string): ShareComment {
    const r = this.db.prepare('INSERT INTO share_comments (album_id, asset_id, author, text, created_at) VALUES (?, ?, ?, ?, ?)').run(albumId, assetId, author.slice(0, 40), text.slice(0, 1000), Date.now())
    return this.comments(albumId).find((c) => c.id === Number(r.lastInsertRowid))!
  }

  toggleLike(albumId: number, assetId: number, author: string): boolean {
    const del = this.db.prepare('DELETE FROM share_likes WHERE album_id = ? AND asset_id = ? AND author = ?').run(albumId, assetId, author)
    if (Number(del.changes)) return false
    this.db.prepare('INSERT INTO share_likes (album_id, asset_id, author, created_at) VALUES (?, ?, ?, ?)').run(albumId, assetId, author.slice(0, 40), Date.now())
    return true
  }

  likes(albumId: number): Map<number, string[]> {
    const m = new Map<number, string[]>()
    for (const r of this.db.prepare('SELECT asset_id, author FROM share_likes WHERE album_id = ?').all(albumId) as Array<{ asset_id: number; author: string }>) {
      m.set(r.asset_id, [...(m.get(r.asset_id) ?? []), r.author])
    }
    return m
  }

  recordUpload(path: string, albumId: number, author: string): void {
    this.db.prepare('INSERT OR REPLACE INTO share_uploads (asset_path, album_id, author, created_at) VALUES (?, ?, ?, ?)').run(path, albumId, author.slice(0, 40), Date.now())
  }

  /** Unseen activity per album for the desktop badge. */
  activity(): Array<{ albumId: number; comments: number; uploads: number }> {
    return this.db.prepare(`SELECT album_id AS albumId, sum(c) AS comments, sum(u) AS uploads FROM (
        SELECT album_id, 1 AS c, 0 AS u FROM share_comments WHERE seen = 0
        UNION ALL SELECT album_id, 0, 1 FROM share_uploads WHERE seen = 0) GROUP BY album_id`).all() as Array<{ albumId: number; comments: number; uploads: number }>
  }

  markSeen(albumId: number): void {
    this.db.prepare('UPDATE share_comments SET seen = 1 WHERE album_id = ?').run(albumId)
    this.db.prepare('UPDATE share_uploads SET seen = 1 WHERE album_id = ?').run(albumId)
  }
}
