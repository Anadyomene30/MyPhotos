import { useCallback, useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { ChevronLeft, ChevronRight, Download, Heart, Loader2, Lock, MessageCircle, Play, Plus, Send, Upload, X } from 'lucide-react'
import { plural } from '@/lib/format'
import { t } from '@/i18n'
import type { AssetTile, ShareComment, SharedAlbumInfo } from '@shared/types'

/**
 * Page opened by family members from a share link (phone or computer on the same network).
 * Talks only to the guest API (/g/api/<token>), never to the private library API.
 */
type Tile = AssetTile & { likes: string[] }

const token = location.pathname.split('/')[2] ?? ''
const base = `/g/api/${token}`
const nameKey = 'mp-guest-name'

function readName(): string {
  try {
    return localStorage.getItem(nameKey) ?? ''
  } catch {
    return ''
  }
}

function saveName(n: string): void {
  try {
    localStorage.setItem(nameKey, n)
  } catch {
    /* ignore */
  }
}

async function json<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(`${base}${path}`, { credentials: 'same-origin', ...init })
  if (!r.ok) throw Object.assign(new Error(((await r.json().catch(() => ({}))) as { error?: string }).error ?? r.statusText), { status: r.status })
  return (await r.json()) as T
}

function PinGate({ onUnlock }: { onUnlock(): void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState<string | null>(null)
  return (
    <form
      className="mx-auto mt-24 w-full max-w-xs space-y-3 px-5 text-center"
      onSubmit={(e) => {
        e.preventDefault()
        json('/unlock', { method: 'POST', body: JSON.stringify({ pin }), headers: { 'content-type': 'application/json' } }).then(onUnlock, (x: Error) => setErr(x.message))
      }}
    >
      <Lock className="mx-auto size-10 text-muted" strokeWidth={1.4} />
      <h1 className="text-[20px] font-bold">{t('Album protégé')}</h1>
      <input autoFocus inputMode="numeric" value={pin} onChange={(e) => setPin(e.target.value)} placeholder={t('Code')} className="w-full rounded-card border border-line bg-surface px-4 py-3 text-center text-[18px] tracking-[0.4em] outline-none focus:border-accent" />
      {err && <p className="text-[13px] text-red-500">{err}</p>}
      <button className="w-full rounded-pill bg-accent py-3 font-bold text-on-accent">{t('Ouvrir')}</button>
    </form>
  )
}

export function GuestApp() {
  const [info, setInfo] = useState<SharedAlbumInfo | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [items, setItems] = useState<Tile[]>([])
  const [open, setOpen] = useState<number | null>(null)
  const [name, setName] = useState(readName)
  const [askName, setAskName] = useState<null | (() => void)>(null)
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null)
  const [dragOver, setDragOver] = useState(false)
  const fileInput = useRef<HTMLInputElement>(null)

  const load = useCallback(async () => {
    try {
      const i = await json<SharedAlbumInfo>('')
      setInfo(i)
      document.title = `${i.name} · MyPhotos`
      if (!i.locked) setItems(await json<Tile[]>('/items?limit=500'))
    } catch (e) {
      setError((e as Error).message)
    }
  }, [])
  useEffect(() => void load(), [load])

  const withName = (fn: (n: string) => void): void => {
    if (name) fn(name)
    else setAskName(() => () => fn(readName()))
  }

  const upload = (files: FileList | File[]): void =>
    withName(async (author) => {
      const list = [...files]
      if (!list.length) return
      setUploading({ done: 0, total: list.length })
      // small batches keep progress visible on phones
      for (let i = 0; i < list.length; i += 4) {
        const fd = new FormData()
        for (const f of list.slice(i, i + 4)) fd.append('files', f, f.name)
        await fetch(`${base}/upload?author=${encodeURIComponent(author)}`, { method: 'POST', body: fd, credentials: 'same-origin' }).catch(() => undefined)
        setUploading({ done: Math.min(list.length, i + 4), total: list.length })
      }
      setUploading(null)
      await load()
    })

  if (error) {
    return (
      <div className="grid min-h-full place-items-center p-8 text-center">
        <div>
          <h1 className="text-[20px] font-bold">{t('Lien indisponible')}</h1>
          <p className="mt-2 text-muted">{error}</p>
        </div>
      </div>
    )
  }
  if (!info) return <div className="grid min-h-full place-items-center"><Loader2 className="size-6 animate-spin text-muted" /></div>
  if (info.locked) return <PinGate onUnlock={() => void load()} />

  return (
    <div
      className="min-h-full text-fg"
      onDragOver={(e) => {
        if (!info.canAdd) return
        e.preventDefault()
        setDragOver(true)
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDragOver(false)
        if (info.canAdd) upload(e.dataTransfer.files)
      }}
    >
      <header className="brume sticky top-0 z-10 border-b border-line">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <div className="min-w-0 flex-1">
            <h1 className="truncate text-[19px] font-bold tracking-tight">{info.name}</h1>
            <p className="text-[12.5px] text-muted">{t('Partagé par {name}', { name: info.owner })} · {plural(items.length, 'photo', 'photos')}</p>
          </div>
          {info.canAdd && (
            <>
              <input ref={fileInput} type="file" multiple accept="image/*,video/*,.heic,.heif,.dng,.cr2,.nef,.arw" className="hidden" onChange={(e) => e.target.files && upload(e.target.files)} />
              <button onClick={() => fileInput.current?.click()} className="flex items-center gap-1.5 rounded-pill bg-accent px-3.5 py-2 text-[13px] font-bold text-on-accent">
                <Plus className="size-4" /> <span className="hidden sm:inline">{t('Ajouter')}</span>
              </button>
            </>
          )}
          <a href={`${base}/zip`} className="flex items-center gap-1.5 rounded-pill border border-line bg-surface px-3.5 py-2 text-[13px] font-bold" title={t('Tout télécharger')}>
            <Download className="size-4" /> <span className="hidden sm:inline">{t('Tout télécharger')}</span>
          </a>
        </div>
        {uploading && (
          <div className="h-1 bg-hover">
            <div className="h-full bg-accent transition-[width]" style={{ width: `${(uploading.done / uploading.total) * 100}%` }} />
          </div>
        )}
      </header>

      {dragOver && (
        <div className="pointer-events-none fixed inset-0 z-20 grid place-items-center bg-accent-soft">
          <div className="rounded-sheet border border-line bg-elevated px-6 py-4 text-[15px] font-bold"><Upload className="mr-2 inline size-5" /> {t('Déposez vos photos pour les ajouter')}</div>
        </div>
      )}

      <main className="mx-auto max-w-6xl p-1 sm:p-4">
        <div className="grid grid-cols-3 gap-[2px] sm:grid-cols-4 sm:gap-1 md:grid-cols-5 lg:grid-cols-6">
          {items.map((it, i) => (
            <button key={it.id} onClick={() => setOpen(i)} className="relative aspect-square overflow-hidden tile-bg">
              <img src={`${base}/thumb/${it.id}?v=${it.v}`} alt="" loading="lazy" className="h-full w-full object-cover" style={{ objectPosition: `${it.fx * 100}% ${it.fy * 100}%` }} />
              {it.kind === 'video' && <Play className="absolute right-1.5 bottom-1.5 size-4 fill-white text-white drop-shadow" />}
              {it.likes.length > 0 && (
                <span className="absolute bottom-1 left-1 flex items-center gap-0.5 rounded-full bg-black/45 px-1.5 py-0.5 text-[10.5px] font-bold text-white">
                  <Heart className="size-3 fill-heart text-heart" /> {it.likes.length}
                </span>
              )}
            </button>
          ))}
        </div>
        {items.length === 0 && <p className="mt-16 text-center text-muted">{t('Cet album est encore vide.')}{info.canAdd ? ` ${t('Ajoutez les premières photos !')}` : ''}</p>}
      </main>

      {open !== null && items[open] && (
        <GuestViewer items={items} index={open} onIndex={setOpen} onClose={() => setOpen(null)} withName={withName} onChanged={() => void load()} />
      )}

      {askName && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/40 p-5">
          <form
            className="w-full max-w-xs space-y-3 rounded-sheet border border-line bg-elevated p-5"
            onSubmit={(e) => {
              e.preventDefault()
              const v = (new FormData(e.currentTarget).get('n') as string).trim()
              if (!v) return
              saveName(v)
              setName(v)
              const cb = askName
              setAskName(null)
              cb()
            }}
          >
            <h2 className="text-[17px] font-bold">{t('Comment vous appelez-vous ?')}</h2>
            <p className="text-[13px] text-muted">{t('Votre prénom accompagne vos photos, commentaires et cœurs.')}</p>
            <input name="n" autoFocus className="w-full rounded-card border border-line bg-surface px-3 py-2.5 outline-none focus:border-accent" placeholder={t('Prénom')} />
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setAskName(null)} className="rounded-pill px-3 py-2 text-[14px] hover:bg-hover">{t('Annuler')}</button>
              <button className="rounded-pill bg-accent px-4 py-2 text-[14px] font-bold text-on-accent">{t('Continuer')}</button>
            </div>
          </form>
        </div>
      )}
    </div>
  )
}

function GuestViewer({ items, index, onIndex, onClose, withName, onChanged }: {
  items: Tile[]
  index: number
  onIndex(i: number): void
  onClose(): void
  withName(fn: (n: string) => void): void
  onChanged(): void
}) {
  const cur = items[index]!
  const [comments, setComments] = useState<ShareComment[]>([])
  const [text, setText] = useState('')
  const [showComments, setShowComments] = useState(false)
  const touch = useRef<number | null>(null)
  const me = readName()
  useEffect(() => {
    void json<ShareComment[]>(`/comments?asset=${cur.id}`).then(setComments, () => setComments([]))
  }, [cur.id])
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight' && index < items.length - 1) onIndex(index + 1)
      if (e.key === 'ArrowLeft' && index > 0) onIndex(index - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [index, items.length, onClose, onIndex])

  const like = (): void =>
    withName((author) => {
      void json(`/like/${cur.id}`, { method: 'POST', body: JSON.stringify({ author }), headers: { 'content-type': 'application/json' } }).then(onChanged)
    })
  const send = (): void =>
    withName((author) => {
      if (!text.trim()) return
      void json<ShareComment>('/comments', { method: 'POST', body: JSON.stringify({ assetId: cur.id, author, text }), headers: { 'content-type': 'application/json' } }).then((c) => {
        setComments((x) => [...x, c])
        setText('')
      })
    })

  return (
    <div
      className="fixed inset-0 z-30 flex flex-col bg-stage text-white"
      onTouchStart={(e) => (touch.current = e.touches[0]!.clientX)}
      onTouchEnd={(e) => {
        const x0 = touch.current
        if (x0 === null) return
        const dx = e.changedTouches[0]!.clientX - x0
        if (dx < -50 && index < items.length - 1) onIndex(index + 1)
        if (dx > 50 && index > 0) onIndex(index - 1)
        touch.current = null
      }}
    >
      <div className="flex items-center gap-2 p-3">
        <button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-white/10" aria-label={t('Fermer')}><X className="size-5" /></button>
        <div className="flex-1 text-center text-[13px] text-white/70">{index + 1} / {items.length}</div>
        <button onClick={like} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-[13px]" aria-label={t('J’aime')}>
          <Heart className={clsx('size-4', cur.likes.includes(me) && 'fill-heart text-heart')} /> {cur.likes.length || ''}
        </button>
        <button onClick={() => setShowComments((v) => !v)} className="flex items-center gap-1 rounded-full bg-white/10 px-3 py-2 text-[13px]" aria-label={t('Commentaires')}>
          <MessageCircle className="size-4" /> {comments.length || ''}
        </button>
        <a href={`${base}/original/${cur.id}?download=1`} className="grid size-9 place-items-center rounded-full bg-white/10" aria-label={t('Télécharger')}><Download className="size-4" /></a>
      </div>
      <div className="relative min-h-0 flex-1">
        {cur.kind === 'video' ? (
          <video key={cur.id} src={`${base}/original/${cur.id}`} controls autoPlay playsInline className="h-full w-full object-contain" />
        ) : (
          <img key={cur.id} src={`${base}/preview/${cur.id}?v=${cur.v}`} alt="" className="h-full w-full object-contain" />
        )}
        {index > 0 && <button onClick={() => onIndex(index - 1)} className="absolute top-1/2 left-2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 sm:grid" aria-label={t('Précédente')}><ChevronLeft className="size-5" /></button>}
        {index < items.length - 1 && <button onClick={() => onIndex(index + 1)} className="absolute top-1/2 right-2 hidden size-10 -translate-y-1/2 place-items-center rounded-full bg-black/40 sm:grid" aria-label={t('Suivante')}><ChevronRight className="size-5" /></button>}
      </div>
      {showComments && (
        <div className="max-h-[40vh] overflow-y-auto border-t border-white/10 bg-stage-panel p-3">
          {comments.map((c) => (
            <p key={c.id} className="py-1 text-[14px]"><span className="font-bold">{c.author}</span> <span className="text-white/85">{c.text}</span></p>
          ))}
          {comments.length === 0 && <p className="py-1 text-[13px] text-white/50">{t('Aucun commentaire pour l’instant.')}</p>}
          <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); send() }}>
            <input value={text} onChange={(e) => setText(e.target.value)} placeholder={t('Ajouter un commentaire')} className="min-w-0 flex-1 rounded-full bg-white/10 px-4 py-2 text-[14px] outline-none" />
            <button className="grid size-9 place-items-center rounded-full bg-accent text-on-accent" aria-label={t('Envoyer')}><Send className="size-4" /></button>
          </form>
        </div>
      )}
    </div>
  )
}
