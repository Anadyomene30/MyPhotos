import { watch, type FSWatcher } from 'node:fs'
import { join } from 'node:path'

/**
 * Recursive native watcher (FSEvents on macOS, ReadDirectoryChangesW on Windows).
 * Much lighter than per-file watchers for 200k-file libraries. Events are batched.
 */
export class FolderWatcher {
  private watchers = new Map<string, FSWatcher>()
  private pending = new Map<string, Set<string>>()
  private timer: NodeJS.Timeout | null = null

  constructor(private onChanges: (root: string, paths: string[]) => void, private debounceMs = 1500) {}

  add(root: string): void {
    if (this.watchers.has(root)) return
    try {
      const w = watch(root, { recursive: true, persistent: false }, (_event, filename) => {
        if (!filename) return
        const set = this.pending.get(root) ?? new Set<string>()
        set.add(join(root, filename.toString()))
        this.pending.set(root, set)
        this.schedule()
      })
      w.on('error', () => this.remove(root))
      this.watchers.set(root, w)
    } catch {
      /* folder unavailable (unplugged drive): the next manual rescan will catch up */
    }
  }

  remove(root: string): void {
    this.watchers.get(root)?.close()
    this.watchers.delete(root)
    this.pending.delete(root)
  }

  close(): void {
    for (const root of [...this.watchers.keys()]) this.remove(root)
    if (this.timer) clearTimeout(this.timer)
  }

  private schedule(): void {
    if (this.timer) clearTimeout(this.timer)
    this.timer = setTimeout(() => {
      this.timer = null
      const batches = [...this.pending.entries()]
      this.pending.clear()
      for (const [root, set] of batches) this.onChanges(root, [...set])
    }, this.debounceMs)
  }
}
