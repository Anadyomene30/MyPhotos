import { useEffect, useState } from 'react'
import { Check, Copy, Link2, Loader2, Share2, Trash2, Wifi, X } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, apiBase, token as apiToken } from '@/api/client'
import { Button, IconButton } from '@/components/ui'
import { confirm } from '@/components/Confirm'
import { useUi } from '@/store'
import { localeTag, t } from '@/i18n'
import type { LanStatus, ShareLink } from '@shared/types'
import { useModal } from '@/components/useModal'

const fmt = new Intl.DateTimeFormat(localeTag(), { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' })

/** Share an album with family on the local network: link + QR code, view-only or view-and-add, optional PIN. */
export function ShareDialog() {
  const albumId = useUi((s) => s.shareAlbumId)
  const close = (): void => useUi.getState().openShare(null)
  const qc = useQueryClient()
  const { data: lan, refetch: refetchLan } = useQuery({ queryKey: ['lan'], queryFn: () => api<LanStatus>('/api/lan'), enabled: albumId !== null })
  const { data: links, refetch } = useQuery({ queryKey: ['shares', albumId], queryFn: () => api<ShareLink[]>(`/api/albums/${albumId}/shares`), enabled: albumId !== null })
  const [canAdd, setCanAdd] = useState(true)
  const [pin, setPin] = useState('')
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  const [addr, setAddr] = useState<string | null>(null)

  useEffect(() => {
    if (lan?.addresses.length && !addr) setAddr(lan.addresses[0]!)
  }, [lan, addr])

  useEffect(() => {
    if (albumId === null) return
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.stopImmediatePropagation()
        close()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [albumId])

  const panelRef = useModal<HTMLDivElement>(albumId !== null)
  if (albumId === null) return null
  const url = (l: ShareLink): string => `http://${addr ?? 'localhost'}:${lan?.port ?? 47810}/s/${l.token}`

  const enable = async (on: boolean): Promise<void> => {
    setBusy(true)
    await api('/api/lan', { method: 'PUT', json: { enabled: on } })
    await refetchLan()
    setBusy(false)
  }
  const create = async (): Promise<void> => {
    setBusy(true)
    try {
      await api(`/api/albums/${albumId}/shares`, { method: 'POST', json: { canAdd, pin: pin.trim() || null } })
      setPin('')
      await refetch()
      await qc.invalidateQueries({ queryKey: ['share-overview'] })
    } finally {
      setBusy(false)
    }
  }
  const copy = (l: ShareLink): void => {
    void navigator.clipboard.writeText(url(l))
    setCopied(l.token)
    setTimeout(() => setCopied(null), 1500)
  }
  const active = links ?? []

  return (
    <div className="animate-fade-in fixed inset-0 z-[58] grid place-items-center bg-black/35" onMouseDown={close}>
      <div ref={panelRef} role="dialog" aria-modal="true" aria-labelledby="share-title" className="animate-pop-in flex max-h-[92vh] w-[620px] max-w-[95vw] flex-col rounded-sheet border border-line bg-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Share2 className="size-4 text-accent" />
          <h2 id="share-title" className="flex-1 font-display text-[16px] font-bold">{t('Partager avec la famille')}</h2>
          <IconButton label={t('Fermer')} onClick={close}><X className="size-4" /></IconButton>
        </div>
        <div className="scroll-thin space-y-5 overflow-y-auto p-5">
          <section className="flex items-start gap-3 rounded-card bg-hover p-3.5">
            <Wifi className="mt-0.5 size-5 text-accent" />
            <div className="min-w-0 flex-1 text-[12.5px] leading-relaxed">
              <div className="text-[13px] font-bold">{lan?.running ? t('Partage sur le réseau local actif') : t('Partage sur le réseau local désactivé')}</div>
              {t('Les personnes connectées au même Wi-Fi ouvrent le lien ou scannent le QR code avec leur téléphone. Rien ne passe par internet. Pour un accès hors de la maison, utilisez Tailscale (voir l’aide).')}
              {lan?.error && <div className="mt-1 text-red-500">{lan.error}</div>}
            </div>
            <Button variant={lan?.running ? 'secondary' : 'primary'} disabled={busy} onClick={() => void enable(!lan?.running)}>
              {busy && <Loader2 className="size-3.5 animate-spin" />} {lan?.running ? t('Désactiver') : t('Activer')}
            </Button>
          </section>

          {lan?.running && (
            <>
              {lan.addresses.length > 1 && (
                <label className="flex items-center gap-2 text-[12px] text-muted">
                  {t('Adresse de cet ordinateur :')}
                  <select className="rounded-card border border-line bg-bg px-2 py-1 text-[12px]" value={addr ?? ''} onChange={(e) => setAddr(e.target.value)}>
                    {lan.addresses.map((a) => <option key={a} value={a}>{a.endsWith('.local') ? t('{address} (nom stable)', { address: a }) : a}</option>)}
                  </select>
                </label>
              )}
              {addr?.endsWith('.local') && (
                <p className="-mt-3 text-[11.5px] text-faint">{t('Le nom en « .local » reste valable si l’adresse change. Il fonctionne sur iPhone, iPad et Mac ; sur Android, préférez l’adresse chiffrée.')}</p>
              )}
              {active.map((l) => (
                <div key={l.id} className="flex gap-4 rounded-card border border-line p-3.5">
                  <img src={`${apiBase}/api/qr?t=${apiToken}&text=${encodeURIComponent(url(l))}`} alt="QR code" className="size-32 shrink-0 rounded-lg bg-white p-1" />
                  <div className="min-w-0 flex-1 space-y-2">
                    <div className="flex items-center gap-2 text-[13px] font-bold">
                      <Link2 className="size-4 text-accent" /> {l.canAdd ? t('Voir et ajouter des photos') : t('Voir seulement')}{l.hasPin ? ` · ${t('protégé par code')}` : ''}
                    </div>
                    <div className="truncate rounded-card bg-bg px-2.5 py-1.5 font-mono text-[11.5px]" title={url(l)}>{url(l)}</div>
                    <div className="text-[11.5px] text-faint">{t('Créé le {date}', { date: fmt.format(l.createdAt) })}{l.lastVisit ? ` · ${t('dernière visite {date}', { date: fmt.format(l.lastVisit) })}` : ` · ${t('pas encore ouvert')}`}</div>
                    <div className="flex gap-2">
                      <Button className="py-1 text-[12px]" onClick={() => copy(l)}>{copied === l.token ? <Check className="size-3.5" /> : <Copy className="size-3.5" />} {copied === l.token ? t('Copié') : t('Copier le lien')}</Button>
                      <Button variant="danger" className="py-1 text-[12px]" onClick={() => void confirm({ title: t('Révoquer ce lien ?'), message: t('Les personnes qui l’ont ne pourront plus voir l’album. Les photos ajoutées restent dans votre photothèque.'), confirmLabel: t('Révoquer'), danger: true }).then(async (ok) => { if (ok) { await api(`/api/shares/${l.id}`, { method: 'DELETE' }); await refetch() } })}>
                        <Trash2 className="size-3.5" /> {t('Révoquer')}
                      </Button>
                    </div>
                  </div>
                </div>
              ))}
              <section className="space-y-2.5 rounded-card border border-dashed border-line p-3.5">
                <div className="text-[13px] font-bold">{t('Nouveau lien')}</div>
                <label className="flex items-center gap-2 text-[13px]"><input type="checkbox" className="accent-[var(--accent)]" checked={canAdd} onChange={(e) => setCanAdd(e.target.checked)} /> {t('Les invités peuvent ajouter leurs photos')}</label>
                <label className="flex items-center gap-2 text-[13px]">
                  {t('Code d’accès (facultatif)')}
                  <input value={pin} onChange={(e) => setPin(e.target.value.replace(/\D/g, '').slice(0, 8))} inputMode="numeric" placeholder={t('ex. 2468')} className="w-28 rounded-card border border-line bg-bg px-2 py-1 text-[13px] outline-none focus:border-accent" />
                </label>
                <Button variant="primary" disabled={busy} onClick={() => void create()}>{t('Créer le lien')}</Button>
                <p className="text-[11.5px] text-faint">{t('Les photos ajoutées par les invités arrivent dans le dossier « Partagés » de votre photothèque et dans cet album.')}</p>
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
