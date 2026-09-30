import { memo } from 'react'
import clsx from 'clsx'

/** Centered slider: double-click resets to zero. The fill starts from the neutral point. */
export const Slider = memo(function Slider({ label, value, min = -100, max = 100, step = 1, onChange, format }: {
  label: string
  value: number
  min?: number
  max?: number
  step?: number
  onChange(v: number): void
  format?(v: number): string
}) {
  const zero = min < 0 ? (0 - min) / (max - min) : 0
  const pos = (value - min) / (max - min)
  const left = Math.min(zero, pos) * 100
  const width = Math.abs(pos - zero) * 100
  return (
    <div className="group py-1" onDoubleClick={() => onChange(0)} title="Double-cliquer pour réinitialiser">
      <div className="mb-1 flex items-center justify-between text-[12px]">
        <span className={clsx(value !== 0 ? 'text-white' : 'text-white/60')}>{label}</span>
        <span className={clsx('tabular-nums', value !== 0 ? 'text-white/90' : 'text-white/35')}>{format ? format(value) : value > 0 ? `+${value}` : value}</span>
      </div>
      <div className="relative h-5">
        <div className="absolute inset-x-0 top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-white/12" />
        <div className="absolute top-1/2 h-[3px] -translate-y-1/2 rounded-full bg-[var(--accent)]" style={{ left: `${left}%`, width: `${width}%` }} />
        {min < 0 && <div className="absolute top-1/2 h-2 w-px -translate-y-1/2 bg-white/30" style={{ left: `${zero * 100}%` }} />}
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onChange={(e) => onChange(Number(e.target.value))}
          className="editor-range absolute inset-0 w-full cursor-pointer appearance-none bg-transparent"
        />
      </div>
    </div>
  )
})
