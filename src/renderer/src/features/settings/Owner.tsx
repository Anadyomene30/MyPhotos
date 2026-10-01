import { useEffect, useState } from 'react'
import { UserRound } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'

/** The name family members see on shared albums ("Partagé par …"). */
export function OwnerSettings() {
  const [name, setName] = useState('')
  const [initial, setInitial] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void api<{ name: string }>('/api/settings/owner').then((r) => {
      setName(r.name)
      setInitial(r.name)
    })
  }, [])
  const save = async (): Promise<void> => {
    const v = name.trim()
    if (!v) return
    await api('/api/settings/owner', { method: 'PUT', json: { name: v } })
    setInitial(v)
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><UserRound className="size-4 text-accent" /> Votre prénom</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">Affiché à votre famille sur les albums partagés : « Partagé par … ».</p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); void save() }}>
        <input value={name} maxLength={40} onChange={(e) => setName(e.target.value)} placeholder="Prénom" className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-accent" />
        <Button type="submit" variant="primary" disabled={!name.trim() || name.trim() === initial}>{saved ? 'Enregistré' : 'Enregistrer'}</Button>
      </form>
    </section>
  )
}
