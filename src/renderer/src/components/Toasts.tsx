import { t } from '@/i18n'
import { X } from 'lucide-react'
import { useUi } from '@/store'

export function Toasts() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  if (!toasts.length) return null
  return (
    <div className="pointer-events-none fixed bottom-5 left-1/2 z-50 flex -translate-x-1/2 flex-col items-center gap-2">
      {toasts.map((toast) => (
        <div key={toast.id} className="animate-pop-in pointer-events-auto flex items-center gap-3 rounded-card border border-line bg-elevated py-2 pr-2 pl-4 text-[13px] text-fg">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="rounded-card px-2 py-1 font-bold text-accent hover:bg-hover"
              onClick={() => {
                toast.action!.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="rounded-card p-1 text-muted hover:bg-hover hover:text-fg" onClick={() => dismiss(toast.id)} aria-label={t('Fermer')}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
