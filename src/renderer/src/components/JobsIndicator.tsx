import { Loader2 } from 'lucide-react'
import { count } from '@/lib/format'
import type { JobGroupState } from '@shared/types'

export function JobsIndicator({ jobs, scanning }: { jobs: JobGroupState[]; scanning: boolean }) {
  if (!scanning && jobs.length === 0) return null
  return (
    <div className="space-y-2 rounded-lg bg-hover px-2.5 py-2">
      {scanning && (
        <div className="flex items-center gap-2 text-[12px] text-muted">
          <Loader2 className="size-3.5 animate-spin" />
          Analyse des dossiers…
        </div>
      )}
      {jobs.map((j) => {
        const pct = j.total ? Math.min(100, (j.done / j.total) * 100) : 0
        return (
          <div key={j.id}>
            <div className="mb-1 flex items-center justify-between gap-2 text-[11.5px]">
              <span className="truncate text-fg/80">{j.label}</span>
              <span className="shrink-0 text-faint tabular-nums">
                {count(j.done)} / {count(j.total)}
              </span>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-line">
              <div className="h-full rounded-full bg-accent transition-[width] duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )
      })}
    </div>
  )
}
