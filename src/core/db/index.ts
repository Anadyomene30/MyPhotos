import { DatabaseSync, type StatementSync } from 'node:sqlite'
import { migrations } from './migrations'

export type Db = DatabaseSync
export type Row = Record<string, unknown>

export function openDb(file: string): Db {
  const db = new DatabaseSync(file)
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA synchronous = NORMAL;
    PRAGMA foreign_keys = ON;
    PRAGMA temp_store = MEMORY;
    PRAGMA cache_size = -65536;
    PRAGMA mmap_size = 268435456;
  `)
  migrate(db)
  return db
}

function migrate(db: Db): void {
  const current = (db.prepare('PRAGMA user_version').get() as { user_version: number }).user_version
  for (let v = current; v < migrations.length; v++) {
    transaction(db, () => {
      db.exec(migrations[v]!)
      db.exec(`PRAGMA user_version = ${v + 1}`)
    })
  }
}

/** Runs fn inside a transaction. Nested calls reuse the outer transaction. */
export function transaction<T>(db: Db, fn: () => T): T {
  if (db.isTransaction) return fn()
  db.exec('BEGIN')
  try {
    const result = fn()
    db.exec('COMMIT')
    return result
  } catch (err) {
    db.exec('ROLLBACK')
    throw err
  }
}

/** Small prepared-statement cache so hot paths don't re-parse SQL. */
export class StatementCache {
  private cache = new Map<string, StatementSync>()
  constructor(private db: Db) {}
  get(sql: string): StatementSync {
    let stmt = this.cache.get(sql)
    if (!stmt) {
      stmt = this.db.prepare(sql)
      this.cache.set(sql, stmt)
    }
    return stmt
  }
}
