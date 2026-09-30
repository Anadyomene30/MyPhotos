import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { useQueryClient } from '@tanstack/react-query'
import { mlApi, useFaces, usePersons } from '@/api/hooks'
import { useUi } from '@/store'
import { MenuItem, MenuSeparator, Popover } from '@/components/Popover'
import { promptText } from '@/components/Prompt'
import type { FaceInfo } from '@shared/types'

/**
 * Face boxes over the displayed photo. Click a box to name the person, confirm a suggestion or
 * say "this is not X". `rect` is the on-screen rectangle of the image.
 */
export function FacesOverlay({ assetId, rect, visible }: { assetId: number; rect: { left: number; top: number; width: number; height: number } | null; visible: boolean }) {
  const { data: faces } = useFaces(assetId)
  const { data: persons } = usePersons(true)
  const qc = useQueryClient()
  const [open, setOpen] = useState<FaceInfo | null>(null)
  const anchor = useRef<HTMLButtonElement | null>(null)
  const refresh = (): void => {
    void qc.invalidateQueries({ queryKey: ['faces', assetId] })
    void qc.invalidateQueries({ queryKey: ['persons'] })
  }
  useEffect(() => setOpen(null), [assetId])
  if (!rect || !faces?.length) return null

  const name = async (f: FaceInfo): Promise<void> => {
    setOpen(null)
    const n = await promptText({ title: 'Qui est-ce ?', placeholder: 'Prénom', confirmLabel: 'Nommer' })
    if (!n) return
    const existing = persons?.find((p) => p.name?.toLowerCase() === n.toLowerCase())
    if (existing) await mlApi.moveFace(f.id, existing.id)
    else await mlApi.namePerson(f.id, n)
    refresh()
  }

  return (
    <>
      {faces.map((f) => {
        const show = visible || f.personName
        if (!show) return null
        return (
          <button
            key={f.id}
            ref={open?.id === f.id ? anchor : undefined}
            onClick={(e) => {
              anchor.current = e.currentTarget
              setOpen(open?.id === f.id ? null : f)
            }}
            className={clsx('absolute rounded-md border-2 transition-colors', visible ? 'border-white/80 hover:border-white' : 'border-transparent hover:border-white/60')}
            style={{ left: rect.left + f.x * rect.width, top: rect.top + f.y * rect.height, width: f.w * rect.width, height: f.h * rect.height }}
            title={f.personName ?? 'Nommer cette personne'}
          >
            {(visible || f.personName) && (
              <span className={clsx('absolute top-full left-1/2 mt-1 -translate-x-1/2 rounded-full px-2 py-0.5 text-[11px] font-medium whitespace-nowrap', f.personName ? 'bg-white text-black' : 'bg-black/60 text-white/90')}>
                {f.personName ?? (f.suggestions[0]?.name ? `${f.suggestions[0].name} ?` : 'Nommer')}
              </span>
            )}
          </button>
        )
      })}
      <Popover anchor={anchor.current} open={Boolean(open)} onClose={() => setOpen(null)} align="start" width={240}>
        {open && (
          <>
            {open.personName && <div className="px-2.5 pt-1.5 pb-1 text-[12px] font-semibold">{open.personName}</div>}
            {open.suggestions.filter((s) => s.name).map((s) => (
              <MenuItem
                key={s.personId}
                onClick={() => {
                  setOpen(null)
                  void mlApi.moveFace(open.id, s.personId).then(refresh)
                }}
              >
                C’est {s.name} ({Math.round(s.score * 100)} %)
              </MenuItem>
            ))}
            <MenuItem onClick={() => void name(open)}>{open.personName ? 'Renommer / autre personne…' : 'Nommer cette personne…'}</MenuItem>
            {open.personId !== null && (
              <>
                <MenuItem onClick={() => {
                  setOpen(null)
                  useUi.getState().closeViewer()
                  useUi.getState().openPerson(open.personId!)
                }}>
                  Voir toutes ses photos
                </MenuItem>
                <MenuItem onClick={() => {
                  setOpen(null)
                  void mlApi.setCover(open.personId!, open.id).then(refresh)
                }}>
                  Utiliser comme photo de profil
                </MenuItem>
                <MenuSeparator />
                <MenuItem danger onClick={() => {
                  setOpen(null)
                  void mlApi.moveFace(open.id, null).then(refresh)
                }}>
                  Ce n’est pas {open.personName ?? 'cette personne'}
                </MenuItem>
              </>
            )}
          </>
        )}
      </Popover>
    </>
  )
}
