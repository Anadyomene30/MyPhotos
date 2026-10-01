import { t, localeTag } from '@/i18n'
import { useEffect, useState } from 'react'
import { Plus, Sparkles, X } from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { albumsApi, useAlbums } from '@/api/hooks'
import { Button, IconButton, Segmented } from '@/components/ui'
import { useUi } from '@/store'
import type { SmartRule, SmartRules } from '@shared/types'

type Field = SmartRule['field']

const FIELDS: Array<{ value: Field; label: string }> = [
  { value: 'kind', label: t('Type') },
  { value: 'year', label: t('Année') },
  { value: 'month', label: t('Mois (toutes années)') },
  { value: 'dateRange', label: t('Période') },
  { value: 'favorite', label: t('Est un favori') },
  { value: 'live', label: t('Est une Live Photo') },
  { value: 'screenshot', label: t('Est une capture d’écran') },
  { value: 'raw', label: t('Est un fichier RAW') },
  { value: 'hasLocation', label: t('A une localisation') },
  { value: 'noLocation', label: t('N’a pas de localisation') },
  { value: 'camera', label: t('Appareil') },
  { value: 'folder', label: t('Dossier') },
  { value: 'name', label: t('Nom du fichier') },
  { value: 'ext', label: t('Extension') },
  { value: 'album', label: t('Album') }
]

const MONTHS = Array.from({ length: 12 }, (_, i) => new Intl.DateTimeFormat(localeTag(), { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(2000, i, 1))))

function defaultRule(field: Field): SmartRule {
  const y = new Date().getFullYear()
  switch (field) {
    case 'kind': return { field, value: 'photo' }
    case 'year': return { field, op: 'is', value: y }
    case 'month': return { field, value: new Date().getMonth() + 1 }
    case 'dateRange': return { field, from: `${y}-01-01`, to: `${y}-12-31` }
    case 'camera': case 'folder': case 'name': return { field, op: 'contains', value: '' }
    case 'ext': return { field, value: 'heic' }
    case 'album': return { field, op: 'in', value: 0 }
    default: return { field } as SmartRule
  }
}

const select = 'rounded-lg border border-line bg-bg px-2 py-1.5 text-[13px] outline-none focus:border-accent'
const input = `${select} min-w-0 flex-1`

function RuleEditor({ rule, onChange }: { rule: SmartRule; onChange(r: SmartRule): void }) {
  const { data: albums } = useAlbums()
  switch (rule.field) {
    case 'kind':
      return (
        <select className={select} value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value as 'photo' | 'video' })}>
          <option value="photo">{t('Photo')}</option>
          <option value="video">{t('Vidéo')}</option>
        </select>
      )
    case 'year':
      return (
        <>
          <select className={select} value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'is' | 'before' | 'after' })}>
            <option value="is">{t('est')}</option>
            <option value="before">{t('avant')}</option>
            <option value="after">{t('après')}</option>
          </select>
          <input className={`${input} max-w-24`} type="number" value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })} />
        </>
      )
    case 'month':
      return (
        <select className={select} value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}>
          {MONTHS.map((m, i) => (
            <option key={m} value={i + 1}>{m}</option>
          ))}
        </select>
      )
    case 'dateRange':
      return (
        <>
          <input className={input} type="date" value={rule.from} onChange={(e) => onChange({ ...rule, from: e.target.value })} />
          <span className="text-muted">{t('au')}</span>
          <input className={input} type="date" value={rule.to} onChange={(e) => onChange({ ...rule, to: e.target.value })} />
        </>
      )
    case 'camera':
    case 'folder':
    case 'name':
      return (
        <>
          <select className={select} value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'contains' | 'notContains' })}>
            <option value="contains">{t('contient')}</option>
            <option value="notContains">{t('ne contient pas')}</option>
          </select>
          <input className={input} value={rule.value} placeholder={rule.field === 'camera' ? 'iPhone, Canon…' : ''} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
        </>
      )
    case 'ext':
      return <input className={`${input} max-w-28`} value={rule.value} onChange={(e) => onChange({ ...rule, value: e.target.value })} />
    case 'album':
      return (
        <>
          <select className={select} value={rule.op} onChange={(e) => onChange({ ...rule, op: e.target.value as 'in' | 'notIn' })}>
            <option value="in">{t('est dans')}</option>
            <option value="notIn">{t('n’est pas dans')}</option>
          </select>
          <select className={`${select} min-w-0 flex-1`} value={rule.value} onChange={(e) => onChange({ ...rule, value: Number(e.target.value) })}>
            <option value={0} disabled>{t('Choisir…')}</option>
            {(albums ?? []).filter((a) => a.kind === 'manual').map((a) => (
              <option key={a.id} value={a.id}>{a.name}</option>
            ))}
          </select>
        </>
      )
    default:
      return null
  }
}

export function SmartAlbumEditor() {
  const editor = useUi((s) => s.smartEditor)
  const setEditor = useUi((s) => s.setSmartEditor)
  const openAlbum = useUi((s) => s.openAlbum)
  const { data: albums } = useAlbums()
  const qc = useQueryClient()
  const existing = editor?.albumId ? albums?.find((a) => a.id === editor.albumId) : undefined
  const [name, setName] = useState('')
  const [rules, setRules] = useState<SmartRules>({ match: 'all', rules: [defaultRule('kind')] })

  useEffect(() => {
    if (!editor) return
    setName(existing?.name ?? '')
    setRules(existing?.rules ?? { match: 'all', rules: [defaultRule('kind')] })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor?.albumId])

  if (!editor) return null
  const close = (): void => setEditor(null)
  const save = async (): Promise<void> => {
    const clean = { ...rules, rules: rules.rules.filter((r) => r.field !== 'album' || r.value > 0) }
    if (existing) {
      await albumsApi.update(existing.id, { name, rules: clean })
    } else {
      const a = await albumsApi.create(name || t('Album intelligent'), { kind: 'smart', rules: clean })
      openAlbum(a.id)
    }
    await qc.invalidateQueries({ queryKey: ['albums'] })
    await qc.invalidateQueries({ queryKey: ['buckets'] })
    close()
  }

  return (
    <div className="animate-fade-in fixed inset-0 z-50 grid place-items-center bg-black/35 backdrop-blur-[2px]" onMouseDown={close}>
      <div className="animate-pop-in w-[620px] max-w-[94vw] rounded-2xl border border-line bg-surface shadow-2xl dark:bg-elevated" onMouseDown={(e) => e.stopPropagation()}>
        <div className="flex items-center gap-3 border-b border-line px-5 py-3.5">
          <Sparkles className="size-4 text-accent" />
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('Nom de l’album intelligent')}
            className="min-w-0 flex-1 bg-transparent font-display text-[16px] font-semibold outline-none focus-visible:outline-none"
          />
          <IconButton label={t('Fermer')} onClick={close}>
            <X className="size-4" />
          </IconButton>
        </div>
        <div className="space-y-3 p-5">
          <div className="flex items-center gap-2 text-[13px]">
            {t('Inclure les éléments qui respectent')}
            <Segmented<'all' | 'any'>
              size="sm"
              value={rules.match}
              onChange={(match) => setRules({ ...rules, match })}
              options={[{ value: 'all', label: t('toutes') }, { value: 'any', label: t('au moins une') }]}
            />
            {t('des règles :')}
          </div>
          <div className="space-y-2">
            {rules.rules.map((r, i) => (
              <div key={i} className="flex items-center gap-2">
                <select
                  className={select}
                  value={r.field}
                  onChange={(e) => {
                    const next = [...rules.rules]
                    next[i] = defaultRule(e.target.value as Field)
                    setRules({ ...rules, rules: next })
                  }}
                >
                  {FIELDS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </select>
                <RuleEditor
                  rule={r}
                  onChange={(nr) => {
                    const next = [...rules.rules]
                    next[i] = nr
                    setRules({ ...rules, rules: next })
                  }}
                />
                <div className="flex-1" />
                <IconButton label={t('Retirer la règle')} onClick={() => setRules({ ...rules, rules: rules.rules.filter((_, j) => j !== i) })}>
                  <X className="size-3.5" />
                </IconButton>
              </div>
            ))}
          </div>
          <Button variant="ghost" className="px-2 py-1 text-[12.5px]" onClick={() => setRules({ ...rules, rules: [...rules.rules, defaultRule('year')] })}>
            <Plus className="size-3.5" /> {t('Ajouter une règle')}
          </Button>
          <p className="text-[12px] text-faint">{t('L’album se met à jour tout seul quand de nouvelles photos correspondent.')}</p>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-3.5">
          <Button onClick={close}>{t('Annuler')}</Button>
          <Button variant="primary" onClick={() => void save()}>
            {existing ? t('Enregistrer') : t('Créer l’album')}
          </Button>
        </div>
      </div>
    </div>
  )
}
