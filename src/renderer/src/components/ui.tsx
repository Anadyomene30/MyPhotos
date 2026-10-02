import clsx from 'clsx'
import { forwardRef, type ButtonHTMLAttributes, type ReactNode } from 'react'

export const IconButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean; label: string }>(function IconButton({ className, active, children, label, ...rest }, ref) {
  return (
    <button
      ref={ref}
      type="button"
      title={label}
      aria-label={label}
      className={clsx(
        'no-drag grid size-8 place-items-center rounded-card text-muted transition-colors hover:bg-hover hover:text-fg disabled:opacity-40',
        active && 'bg-hover text-fg',
        className
      )}
      {...rest}
    >
      {children}
    </button>
  )
})

export function Segmented<T extends string>({ value, options, onChange, size = 'md' }: {
  value: T
  options: Array<{ value: T; label: ReactNode; title?: string }>
  onChange(v: T): void
  size?: 'sm' | 'md'
}) {
  return (
    <div className="no-drag flex items-center rounded-pill bg-hover p-[3px]">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          title={o.title}
          onClick={() => onChange(o.value)}
          className={clsx(
            'rounded-pill transition-all',
            size === 'sm' ? 'px-2.5 py-[3px] text-[12px]' : 'px-3 py-1 text-[12.5px]',
            value === o.value ? 'bg-elevated text-fg' : 'text-muted hover:text-fg'
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  )
}

export function Button({ className, variant = 'secondary', ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' | 'ghost' | 'danger' }) {
  return (
    <button
      type="button"
      className={clsx(
        'no-drag inline-flex items-center justify-center gap-2 rounded-pill px-3.5 py-[7px] text-[13px] font-bold transition-colors disabled:opacity-50',
        variant === 'primary' && 'bg-accent text-on-accent hover:brightness-110',
        variant === 'secondary' && 'bg-hover text-fg hover:bg-line',
        variant === 'ghost' && 'text-muted hover:bg-hover hover:text-fg',
        variant === 'danger' && 'bg-red-500/10 text-red-500 hover:bg-red-500/20',
        className
      )}
      {...rest}
    />
  )
}
