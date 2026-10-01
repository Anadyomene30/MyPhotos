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
        <div key={toast.id} className="animate-pop-in pointer-events-auto flex items-center gap-3 rounded-xl bg-neutral-900/92 py-2 pr-2 pl-4 text-[13px] text-white shadow-2xl backdrop-blur-xl dark:bg-neutral-800/95">
          <span>{toast.message}</span>
          {toast.action && (
            <button
              className="rounded-md px-2 py-1 font-semibold text-sky-400 hover:bg-white/10"
              onClick={() => {
                toast.action!.run()
                dismiss(toast.id)
              }}
            >
              {toast.action.label}
            </button>
          )}
          <button className="rounded-md p-1 text-white/60 hover:bg-white/10 hover:text-white" onClick={() => dismiss(toast.id)} aria-label={t('Fermer')}>
            <X className="size-3.5" />
          </button>
        </div>
      ))}
    </div>
  )
}
