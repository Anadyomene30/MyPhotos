import { hostname, networkInterfaces } from 'node:os'
import type { ServerType } from '@hono/node-server'
import { serve } from '@hono/node-server'
import type { Hono } from 'hono'
import type { LanStatus } from '@shared/types'
import { t } from '@shared/i18n'

/** Private IPv4 addresses family members can reach on the local network. */
export function lanAddresses(): string[] {
  const out: string[] = []
  for (const list of Object.values(networkInterfaces())) {
    for (const a of list ?? []) {
      if (a.family !== 'IPv4' || a.internal) continue
      if (/^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|100\.)/.test(a.address)) out.push(a.address)
    }
  }
  // the usual home router ranges first, VPN/virtual last
  out.sort((a, b) => (a.startsWith('192.168.1.') || a.startsWith('192.168.0.') ? -1 : 0) - (b.startsWith('192.168.1.') || b.startsWith('192.168.0.') ? -1 : 0))
  // macOS answers to "<name>.local" (Bonjour): stable when the router hands out a new IP
  const host = hostname()
  if (process.platform === 'darwin' && host.endsWith('.local') && out.length) out.push(host)
  return out
}

/** Guest server bound to all interfaces, started only while sharing is enabled. */
export class LanServer {
  private server: ServerType | null = null
  private error: string | null = null
  constructor(private app: Hono, readonly port: number) {}

  status(enabled: boolean): LanStatus {
    return { enabled, running: Boolean(this.server), port: this.port, addresses: this.server ? lanAddresses() : [], error: this.error }
  }

  start(): Promise<void> {
    if (this.server) return Promise.resolve()
    this.error = null
    return new Promise((resolve) => {
      const s = serve({ fetch: this.app.fetch, hostname: '0.0.0.0', port: this.port }, () => resolve())
      s.on('error', (e: NodeJS.ErrnoException) => {
        this.error = e.code === 'EADDRINUSE' ? t('Le port {port} est déjà utilisé', { port: this.port }) : e.message
        this.server = null
        resolve()
      })
      this.server = s
    })
  }

  stop(): Promise<void> {
    const s = this.server
    this.server = null
    return new Promise((resolve) => (s ? s.close(() => resolve()) : resolve()))
  }
}
