import { DatabaseSync } from 'node:sqlite'
import { parentPort, workerData } from 'node:worker_threads'
import { applyTaskLocale, runDbTask, type DbTask } from './dbTasks'
import type { Locale } from '@shared/i18n'

/** Worker thread for whole-library read-only computations (cleanup report, memories, moments). */
const db = new DatabaseSync((workerData as { dbPath: string }).dbPath, { readOnly: true })
db.exec(`
  PRAGMA busy_timeout = 5000;
  PRAGMA temp_store = MEMORY;
  PRAGMA cache_size = -65536;
  PRAGMA mmap_size = 268435456;
`)

parentPort?.on('message', (m: { id: number; t: DbTask; locale: Locale; tag: string }) => {
  try {
    applyTaskLocale(m.locale, m.tag)
    parentPort?.postMessage({ id: m.id, ok: true, result: runDbTask(db, m.t) })
  } catch (e) {
    parentPort?.postMessage({ id: m.id, ok: false, error: (e as Error).message })
  }
})
