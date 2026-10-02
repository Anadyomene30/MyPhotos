import { useState } from 'react'
import clsx from 'clsx'
import { House, Loader2, Plus } from 'lucide-react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api } from '@/api/client'
import { Button } from '@/components/ui'
import { Ombre } from '@/components/Globe'
import { MEMBER_OBJECTS, MemberAvatar, objectLabel, Silhouette } from '@/components/MemberHead'
import { localeTag, t } from '@/i18n'
import type { HouseholdFolder, HouseholdMember, HouseholdStatus } from '@shared/types'

/**
 * The household (LesDaguesHautes spec/01 § 4–5). Optional: without it MyPhotos works as before. The launcher's
 * machine-wide choice, when there is one, is only offered (« Continuer en tant que… »); MyPhotos can do the whole
 * journey itself: choose the folder, create the household if needed, then « qui est là ? ».
 */
export function useHousehold() {
  return useQuery({ queryKey: ['household'], queryFn: () => api<HouseholdStatus>('/api/household') })
}

type Step = { kind: 'idle' } | { kind: 'path' } | { kind: 'create'; dir: string } | { kind: 'who'; dir: string; folder: HouseholdFolder }

const folderName = (dir: string): string => dir.split(/[\\/]/).filter(Boolean).pop() ?? dir

export function HouseholdSettings() {
  const { data: status } = useHousehold()
  const qc = useQueryClient()
  const [step, setStep] = useState<Step>({ kind: 'idle' })
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const run = async (fn: () => Promise<void>): Promise<void> => {
    setBusy(true)
    setError(null)
    try {
      await fn()
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setBusy(false)
    }
  }

  const openFolder = (dir: string): Promise<void> =>
    run(async () => {
      const folder = await api<HouseholdFolder>('/api/household/folder', { method: 'POST', json: { dir } })
      setStep(folder.exists ? { kind: 'who', dir, folder } : { kind: 'create', dir })
    })

  const pick = async (): Promise<void> => {
    if (!window.desktop) return setStep({ kind: 'path' })
    const dir = await window.desktop.pickFolder({ title: t('Choisir le dossier foyer'), button: t('Choisir') })
    if (dir) await openFolder(dir)
  }

  const join = (dir: string, memberId: string): Promise<void> =>
    run(async () => {
      qc.setQueryData(['household'], await api<HouseholdStatus>('/api/household/join', { method: 'POST', json: { dir, memberId } }))
      setStep({ kind: 'idle' })
    })

  const leave = (): Promise<void> =>
    run(async () => {
      qc.setQueryData(['household'], await api<HouseholdStatus>('/api/household', { method: 'DELETE' }))
    })

  if (!status) return null

  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-bold"><House className="size-4 text-accent" /> {t('Foyer')}</h3>

      {step.kind === 'idle' && status.joined && status.me && (
        <>
          <div className="flex items-center gap-3 rounded-card border border-line px-3.5 py-3">
            <MemberAvatar objet={status.me.objet} size={40} background="var(--dh-bg)" />
            <div className="min-w-0 flex-1">
              <div className="truncate text-[14px] font-bold">{status.me.name}</div>
              <div className="truncate text-[12px] text-muted" title={status.dir ?? undefined}>
                {status.name ? `${status.name} · ` : ''}{t('Dossier foyer : {name}', { name: folderName(status.dir ?? '') })}
              </div>
            </div>
            <Button variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={() => void leave()} disabled={busy}>{t('Quitter le foyer')}</Button>
          </div>
          {!status.reachable && (
            <p className="mt-2 text-[12px] text-muted">
              {status.seenAt
                ? t('Dossier foyer injoignable. Dernière lecture le {date}.', { date: new Date(status.seenAt).toLocaleString(localeTag(), { dateStyle: 'long', timeStyle: 'short' }) })
                : t('Dossier foyer injoignable.')}
            </p>
          )}
          <p className="mt-2 text-[12px] leading-relaxed text-muted">
            {t('Vos albums restent à vous. Sur un album partagé, les membres du foyer peuvent se présenter : « Je suis… ». La photothèque et les originaux restent sur cet ordinateur.')}
          </p>
        </>
      )}

      {step.kind === 'idle' && !status.joined && (
        <>
          <p className="mb-3 text-[12px] leading-relaxed text-muted">
            {t('Rejoignez le foyer pour que vos proches vous reconnaissent sur les albums partagés. La photothèque et les originaux restent sur cet ordinateur ; MyPhotos marche de la même façon sans foyer.')}
          </p>
          <div className="flex flex-wrap gap-2">
            {status.preset && (
              <Button variant="primary" disabled={busy} onClick={() => void join(status.preset!.dir, status.preset!.member.id)}>
                <MemberAvatar objet={status.preset.member.objet} size={20} background="var(--dh-elevated)" />
                {t('Continuer en tant que {name}', { name: status.preset.member.name })}
              </Button>
            )}
            <Button variant={status.preset ? 'secondary' : 'primary'} disabled={busy} onClick={() => void pick()}>
              {busy && <Loader2 className="size-4 animate-spin" />}
              {status.preset ? t('Un autre dossier…') : t('Rejoindre le foyer…')}
            </Button>
          </div>
        </>
      )}

      {step.kind === 'path' && <PathStep busy={busy} onOpen={(d) => void openFolder(d)} onCancel={() => setStep({ kind: 'idle' })} />}

      {step.kind === 'create' && (
        <CreateStep
          dir={step.dir}
          busy={busy}
          onCreate={(name) =>
            void run(async () => {
              const folder = await api<HouseholdFolder>('/api/household/create', { method: 'POST', json: { dir: step.dir, name } })
              setStep({ kind: 'who', dir: step.dir, folder })
            })
          }
          onOther={() => void pick()}
          onCancel={() => setStep({ kind: 'idle' })}
        />
      )}

      {step.kind === 'who' && (
        <WhoStep
          folder={step.folder}
          busy={busy}
          onPick={(m) => void join(step.dir, m.id)}
          onNew={(name, objet) =>
            void run(async () => {
              const m = await api<HouseholdMember>('/api/household/members', { method: 'POST', json: { dir: step.dir, name, objet } })
              qc.setQueryData(['household'], await api<HouseholdStatus>('/api/household/join', { method: 'POST', json: { dir: step.dir, memberId: m.id } }))
              setStep({ kind: 'idle' })
            })
          }
          onCancel={() => setStep({ kind: 'idle' })}
        />
      )}

      {error && <p className="mt-2 text-[12px] text-red-500">{error}</p>}
    </section>
  )
}

const field = 'min-w-0 flex-1 rounded-card border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-accent'

/** Browser without the desktop shell (headless development): type the folder path. */
function PathStep({ busy, onOpen, onCancel }: { busy: boolean; onOpen(dir: string): void; onCancel(): void }) {
  const [dir, setDir] = useState('')
  return (
    <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (dir.trim()) onOpen(dir.trim()) }}>
      <input value={dir} onChange={(e) => setDir(e.target.value)} placeholder={t('Chemin du dossier foyer')} className={field} autoFocus />
      <Button type="submit" variant="primary" disabled={busy || !dir.trim()}>{t('Choisir')}</Button>
      <Button variant="ghost" onClick={onCancel}>{t('Annuler')}</Button>
    </form>
  )
}

function CreateStep({ dir, busy, onCreate, onOther, onCancel }: { dir: string; busy: boolean; onCreate(name: string): void; onOther(): void; onCancel(): void }) {
  const [name, setName] = useState('Les Dagues Hautes')
  return (
    <div className="space-y-3">
      <h4 className="etiquette">{t('Un nouveau foyer…')}</h4>
      <p className="text-[12px] leading-relaxed text-muted">
        {t('Le dossier « {name} » n’a pas encore de foyer. Donnez-lui un nom ; les autres membres le rejoindront en choisissant le même dossier.', { name: folderName(dir) })}
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (name.trim()) onCreate(name.trim()) }}>
        <input value={name} maxLength={60} onChange={(e) => setName(e.target.value)} aria-label={t('Nom du foyer')} placeholder={t('Nom du foyer')} className={field} autoFocus />
        <Button type="submit" variant="primary" disabled={busy || !name.trim()}>{t('Créer le foyer')}</Button>
      </form>
      <div className="flex gap-2">
        <Button variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={onOther}>{t('Un autre dossier…')}</Button>
        <Button variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={onCancel}>{t('Annuler')}</Button>
      </div>
      <Privacy />
    </div>
  )
}

/** spec/01 § 3, rule 3: said when choosing the folder. */
function Privacy() {
  return <p className="text-[11.5px] leading-relaxed text-faint">{t('Toute personne qui a accès au dossier foyer peut en lire les fichiers : ce que l’on y garde pour soi l’est par convention, pas par protection.')}</p>
}

function WhoStep({ folder, busy, onPick, onNew, onCancel }: {
  folder: HouseholdFolder
  busy: boolean
  onPick(m: HouseholdMember): void
  onNew(name: string, objet: string): void
  onCancel(): void
}) {
  const [adding, setAdding] = useState(folder.members.length === 0)
  const { data: owner } = useQuery({ queryKey: ['owner'], queryFn: () => api<{ name: string }>('/api/settings/owner') })
  // spec/01 § 10: the name MyPhotos already knew becomes the profile's name
  const [name, setName] = useState<string | null>(null)
  const [objet, setObjet] = useState<string>('globe')
  const shown = name ?? owner?.name ?? ''
  return (
    <div className="space-y-3">
      <h4 className="etiquette">{t('Qui est là ?')}</h4>
      <p className="text-[12px] leading-relaxed text-muted">{folder.name ? t('Le foyer « {name} ». Choisissez-vous.', { name: folder.name }) : t('Choisissez-vous.')}</p>
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        {folder.members.map((m) => (
          <button key={m.id} type="button" disabled={busy} onClick={() => onPick(m)} className="group flex flex-col items-center gap-1 rounded-card px-1 pt-1 pb-1.5 hover:bg-hover">
            <span className="flex flex-col items-center transition-transform group-hover:-translate-y-1">
              <Silhouette objet={m.objet} height={112} />
            </span>
            <Ombre width={64} />
            <span className="text-[13px] font-bold">{m.name}</span>
          </button>
        ))}
        {!adding && (
          <button type="button" onClick={() => setAdding(true)} className="flex h-[150px] w-[76px] flex-col items-center justify-end gap-2 rounded-card pb-1.5 text-muted hover:bg-hover hover:text-fg">
            <Plus className="size-6" strokeWidth={1.5} />
            <span className="text-center text-[12px] leading-tight">{t('Nouveau membre')}</span>
          </button>
        )}
      </div>
      {adding && (
        <form className="space-y-3 rounded-card border border-line p-3" onSubmit={(e) => { e.preventDefault(); if (shown.trim()) onNew(shown.trim(), objet) }}>
          <label className="flex items-center gap-3 text-[12px] font-bold text-muted">
            {t('Prénom')}
            <input value={shown} maxLength={40} onChange={(e) => setName(e.target.value)} className={field} autoFocus />
          </label>
          <fieldset>
            <legend className="mb-1.5 text-[12px] font-bold text-muted">{t('Votre objet')}</legend>
            <div className="flex flex-wrap gap-1.5">
              {MEMBER_OBJECTS.map((o) => (
                <label key={o} className={clsx('flex cursor-pointer flex-col items-center gap-1 rounded-card px-2 py-1.5 text-[11.5px] has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-accent', o === objet ? 'bg-accent-soft font-bold text-fg' : 'text-muted hover:bg-hover')}>
                  <input type="radio" name="objet" value={o} checked={o === objet} onChange={() => setObjet(o)} className="sr-only" />
                  <MemberAvatar objet={o} size={40} background="var(--dh-bg)" />
                  {objectLabel(o)}
                </label>
              ))}
            </div>
          </fieldset>
          <div className="flex gap-2">
            <Button type="submit" variant="primary" disabled={busy || !shown.trim()}>{t('C’est moi')}</Button>
            {folder.members.length > 0 && <Button variant="ghost" onClick={() => setAdding(false)}>{t('Annuler')}</Button>}
          </div>
        </form>
      )}
      <div className="flex gap-2">
        <Button variant="ghost" className="px-2.5 py-1 text-[12px]" onClick={onCancel}>{t('Plus tard')}</Button>
      </div>
      <Privacy />
    </div>
  )
}
