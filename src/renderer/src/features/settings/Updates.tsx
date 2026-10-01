import { Download, Loader2, RefreshCw, RotateCw, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Button } from '@/components/ui'
import { t } from '@/i18n'

type UpdateState = Awaited<ReturnType<NonNullable<NonNullable<Window['desktop']>['update']>['check']>>

/** Update state pushed by the desktop shell; null outside the packaged desktop app. */
function useUpdate(): { state: UpdateState; version: string; enabled: boolean } | null {
  const bridge = window.desktop?.update
  const [info, setInfo] = useState<{ state: UpdateState; version: string; enabled: boolean } | null>(null)
  useEffect(() => {
    if (!bridge) return
    let alive = true
    void bridge.get().then((i) => alive && setInfo(i))
    const off = bridge.onState((state) => setInfo((i) => (i ? { ...i, state } : i)))
    return () => {
      alive = false
      off()
    }
  }, [bridge])
  return info
}

function statusText(s: UpdateState): string {
  switch (s.status) {
    case 'checking':
      return t('Recherche de mises à jour…')
    case 'latest':
      return t('MyPhotos est à jour.')
    case 'downloading':
      return t('Téléchargement de la version {version} ({percent} %)', { version: s.version, percent: s.percent })
    case 'ready':
      return t('La version {version} est prête : elle s’installera au prochain démarrage.', { version: s.version })
    case 'available':
      return t('La version {version} est disponible.', { version: s.version })
    case 'error':
      return t('Impossible de vérifier les mises à jour : {message}', { message: s.message })
    default:
      return t('MyPhotos recherche les nouvelles versions automatiquement.')
  }
}

export function UpdateSettings() {
  const info = useUpdate()
  if (!info) return null
  const s = info.state
  return (
    <section>
      <div className="flex items-center justify-between gap-3">
        <h3 className="flex items-center gap-2 text-[13px] font-semibold">
          <RefreshCw className="size-4 text-accent" /> {t('Mises à jour')}
        </h3>
        <span className="text-[12px] text-muted">{t('Version {version}', { version: info.version })}</span>
      </div>
      <p className="mt-1.5 text-[12px] text-muted">{info.enabled ? statusText(s) : t('Les mises à jour ne s’appliquent qu’à l’application installée.')}</p>
      {info.enabled && (
        <div className="mt-2.5 flex gap-2">
          {s.status === 'ready' ? (
            <Button variant="primary" onClick={() => void window.desktop!.update!.install()}>
              <RotateCw className="size-4" /> {t('Redémarrer et mettre à jour')}
            </Button>
          ) : s.status === 'available' ? (
            <Button variant="primary" onClick={() => void window.desktop!.update!.install()}>
              <Download className="size-4" /> {t('Télécharger')}
            </Button>
          ) : (
            <Button disabled={s.status === 'checking' || s.status === 'downloading'} onClick={() => void window.desktop!.update!.check()}>
              {s.status === 'checking' ? <Loader2 className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} {t('Rechercher maintenant')}
            </Button>
          )}
        </div>
      )}
    </section>
  )
}

const DISMISS_KEY = 'mp-update-dismissed'

/** Small card in the corner when a new version is ready or can be downloaded. Dismissed per version. */
export function UpdateNotice() {
  const info = useUpdate()
  const [dismissed, setDismissed] = useState<string | null>(() => {
    try {
      return localStorage.getItem(DISMISS_KEY)
    } catch {
      return null
    }
  })
  const s = info?.state
  if (!s || (s.status !== 'ready' && s.status !== 'available') || dismissed === s.version) return null
  const dismiss = (): void => {
    setDismissed(s.version)
    try {
      localStorage.setItem(DISMISS_KEY, s.version)
    } catch {
      /* storage unavailable: hidden for this session */
    }
  }
  return (
    <div role="status" className="animate-pop-in fixed right-5 bottom-5 z-40 w-[300px] rounded-2xl border border-line bg-surface p-4 shadow-2xl dark:bg-elevated">
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <div className="text-[13px] font-semibold">{t('Nouvelle version de MyPhotos')}</div>
          <p className="mt-1 text-[12px] leading-relaxed text-muted">
            {s.status === 'ready'
              ? t('La version {version} est prête. Redémarrez pour l’installer, ou elle s’installera à la fermeture.', { version: s.version })
              : t('La version {version} est disponible au téléchargement.', { version: s.version })}
          </p>
        </div>
        <button className="rounded-md p-1 text-muted hover:bg-black/5 hover:text-fg dark:hover:bg-white/10" onClick={dismiss} aria-label={t('Plus tard')}>
          <X className="size-3.5" />
        </button>
      </div>
      <div className="mt-3 flex justify-end gap-2">
        <Button onClick={dismiss}>{t('Plus tard')}</Button>
        <Button variant="primary" onClick={() => void window.desktop!.update!.install()}>
          {s.status === 'ready' ? t('Redémarrer') : t('Télécharger')}
        </Button>
      </div>
    </div>
  )
}
