import type { ServerEvent } from '@shared/types'

const params = new URLSearchParams(location.search)

function initToken(): string {
  const fromUrl = params.get('t')
  if (fromUrl) {
    try {
      sessionStorage.setItem('mp-token', fromUrl)
    } catch {
      /* storage unavailable */
    }
    return fromUrl
  }
  try {
    return sessionStorage.getItem('mp-token') ?? ''
  } catch {
    return ''
  }
}

export const token = initToken()
export const apiBase = (params.get('api') ?? '').replace(/\/$/, '')

// Keep the token out of the visible URL once read.
if (params.has('t')) {
  params.delete('t')
  const q = params.toString()
  history.replaceState(null, '', location.pathname + (q ? `?${q}` : '') + location.hash)
}

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message)
  }
}

export async function api<T>(path: string, init: RequestInit & { json?: unknown } = {}): Promise<T> {
  const headers = new Headers(init.headers)
  headers.set('x-token', token)
  let body = init.body
  if (init.json !== undefined) {
    headers.set('content-type', 'application/json')
    body = JSON.stringify(init.json)
  }
  const res = await fetch(`${apiBase}${path}`, { ...init, headers, body })
  if (!res.ok) {
    let msg = res.statusText
    try {
      msg = ((await res.json()) as { error?: string }).error ?? msg
    } catch {
      /* not json */
    }
    throw new ApiError(res.status, msg)
  }
  return (await res.json()) as T
}

export const qs = (o: Record<string, string | number | undefined | null>): string => {
  const p = new URLSearchParams()
  for (const [k, v] of Object.entries(o)) if (v !== undefined && v !== null && v !== '' && v !== 'all') p.set(k, String(v))
  const s = p.toString()
  return s ? `?${s}` : ''
}

export const media = {
  thumb: (id: number, v = 0): string => `${apiBase}/api/thumb/${id}?t=${token}&v=${v}`,
  preview: (id: number, v = 0): string => `${apiBase}/api/preview/${id}?t=${token}&v=${v}`,
  original: (id: number): string => `${apiBase}/api/original/${id}?t=${token}`,
  download: (id: number): string => `${apiBase}/api/original/${id}?t=${token}&download=1`,
  live: (id: number): string => `${apiBase}/api/live/${id}?t=${token}`
}

type Listener = (e: ServerEvent) => void
const listeners = new Set<Listener>()
let source: EventSource | null = null

export function onServerEvent(fn: Listener): () => void {
  listeners.add(fn)
  if (!source) {
    source = new EventSource(`${apiBase}/api/events?t=${token}`)
    source.onmessage = (m) => {
      try {
        const e = JSON.parse(m.data) as ServerEvent
        for (const l of listeners) l(e)
      } catch {
        /* ignore malformed */
      }
    }
  }
  return () => listeners.delete(fn)
}
