import { createReadStream } from 'node:fs'
import { stat } from 'node:fs/promises'
import { Readable } from 'node:stream'
import type { Context } from 'hono'

const MIME: Record<string, string> = {
  jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif',
  avif: 'image/avif', heic: 'image/heic', heif: 'image/heif', tif: 'image/tiff', tiff: 'image/tiff', bmp: 'image/bmp',
  mov: 'video/quicktime', mp4: 'video/mp4', m4v: 'video/mp4', webm: 'video/webm', mkv: 'video/x-matroska', avi: 'video/x-msvideo',
  html: 'text/html; charset=utf-8', js: 'text/javascript; charset=utf-8', css: 'text/css; charset=utf-8', svg: 'image/svg+xml',
  json: 'application/json', woff2: 'font/woff2', ico: 'image/x-icon', mp3: 'audio/mpeg', m4a: 'audio/mp4', pdf: 'application/pdf'
}

export function mimeFor(file: string): string {
  const ext = file.slice(file.lastIndexOf('.') + 1).toLowerCase()
  return MIME[ext] ?? 'application/octet-stream'
}

/** Stream a file with HTTP Range support (needed for video seeking). */
export async function sendFile(c: Context, file: string, opts: { type?: string; cache?: string; download?: string } = {}): Promise<Response> {
  let size: number
  try {
    const st = await stat(file)
    if (!st.isFile()) return c.text('Not found', 404)
    size = st.size
  } catch {
    return c.text('Not found', 404)
  }
  const headers: Record<string, string> = {
    'Content-Type': opts.type ?? mimeFor(file),
    'Accept-Ranges': 'bytes',
    'Cache-Control': opts.cache ?? 'private, max-age=0, must-revalidate'
  }
  if (opts.download) headers['Content-Disposition'] = `attachment; filename*=UTF-8''${encodeURIComponent(opts.download)}`
  const range = c.req.header('range')
  if (range) {
    const m = /bytes=(\d*)-(\d*)/.exec(range)
    if (m) {
      let start = m[1] ? parseInt(m[1], 10) : NaN
      let end = m[2] ? parseInt(m[2], 10) : NaN
      if (Number.isNaN(start)) {
        start = Math.max(0, size - (Number.isNaN(end) ? 0 : end))
        end = size - 1
      } else if (Number.isNaN(end) || end >= size) end = size - 1
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { 'Content-Range': `bytes */${size}` } })
      }
      headers['Content-Range'] = `bytes ${start}-${end}/${size}`
      headers['Content-Length'] = String(end - start + 1)
      const body = Readable.toWeb(createReadStream(file, { start, end })) as ReadableStream
      return new Response(body, { status: 206, headers })
    }
  }
  headers['Content-Length'] = String(size)
  if (c.req.method === 'HEAD') return new Response(null, { status: 200, headers })
  return new Response(Readable.toWeb(createReadStream(file)) as ReadableStream, { status: 200, headers })
}
