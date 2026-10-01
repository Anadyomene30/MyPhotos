import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { Worker } from 'node:worker_threads'
import type { Db } from './db'
import { buildCleanupReport } from './cleanup'
import { proposeMemories, type MemoryDraft } from './organize/memories'
import { planMoments, type MomentPlan } from './organize/moments'
import type { CleanupReport } from '@shared/types'

/**
 * Read-only computations over the whole library. At 200k assets each takes seconds, so the backend runs them in a
 * worker thread on its own read-only connection; the HTTP server keeps answering meanwhile.
 */
export type DbTask =
  | { task: 'cleanup'; version: number; creationsSource: number | null }
  | { task: 'memories'; now: number }
  | { task: 'moments' }

export interface DbTaskResult {
  cleanup: CleanupReport
  memories: MemoryDraft[]
  moments: MomentPlan
}

export function runDbTask(db: Db, t: DbTask): DbTaskResult[DbTask['task']] {
  switch (t.task) {
    case 'cleanup':
      return buildCleanupReport(db, t.version, undefined, t.creationsSource)
    case 'memories':
      return proposeMemories(db, new Date(t.now))
    case 'moments':
      return planMoments(db)
  }
}

type Pending = { resolve(v: unknown): void; reject(e: Error): void }

/** Runs DbTasks in `db-worker.js` when a worker directory is given and built, inline otherwise (tests). */
export class DbTaskRunner {
  private worker: Worker | null = null
  private seq = 0
  private pending = new Map<number, Pending>()

  constructor(private db: Db, private dbPath: string, private workerDir?: string) {}

  private get file(): string | null {
    if (!this.workerDir) return null
    const f = join(this.workerDir, 'db-worker.js')
    return existsSync(f) ? f : null
  }

  run<K extends DbTask['task']>(t: Extract<DbTask, { task: K }>): Promise<DbTaskResult[K]> {
    const file = this.file
    if (!file) {
      try {
        return Promise.resolve(runDbTask(this.db, t) as DbTaskResult[K])
      } catch (e) {
        return Promise.reject(e as Error)
      }
    }
    if (!this.worker) {
      const w = new Worker(file, { workerData: { dbPath: this.dbPath } })
      w.on('message', (m: { id: number; ok: boolean; result?: unknown; error?: string }) => {
        const p = this.pending.get(m.id)
        if (!p) return
        this.pending.delete(m.id)
        if (m.ok) p.resolve(m.result)
        else p.reject(new Error(m.error ?? 'db task failed'))
      })
      const fail = (e: Error): void => {
        this.worker = null
        for (const p of this.pending.values()) p.reject(e)
        this.pending.clear()
      }
      w.on('error', fail)
      w.on('exit', () => fail(new Error('db worker exited')))
      w.unref()
      this.worker = w
    }
    const id = ++this.seq
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (v: unknown) => void, reject })
      this.worker!.postMessage({ id, t })
    })
  }

  async close(): Promise<void> {
    const w = this.worker
    this.worker = null
    if (w) await w.terminate()
  }
}
