import { useEffect, useState } from 'react'
import { Cloud } from 'lucide-react'
import { api } from '@/api/client'
import { Button } from '@/components/ui'

/** Optional Claude API key for titles and captions of memories. Off by default. */
export function CloudSettings() {
  const [hasKey, setHasKey] = useState(false)
  const [value, setValue] = useState('')
  const [saved, setSaved] = useState(false)
  useEffect(() => {
    void api<{ hasKey: boolean }>('/api/settings/cloud').then((r) => setHasKey(r.hasKey))
  }, [])
  const save = async (key: string | null): Promise<void> => {
    const r = await api<{ hasKey: boolean }>('/api/settings/cloud', { method: 'PUT', json: { apiKey: key } })
    setHasKey(r.hasKey)
    setValue('')
    setSaved(true)
    setTimeout(() => setSaved(false), 2000)
  }
  return (
    <section>
      <h3 className="mb-2 flex items-center gap-2 text-[13px] font-semibold"><Cloud className="size-4 text-accent" /> Claude (option)</h3>
      <p className="mb-3 text-[12px] leading-relaxed text-muted">
        Avec une clé API Claude, MyPhotos peut proposer des titres et légendes plus évocateurs pour vos souvenirs. Seules quelques vignettes réduites sont envoyées, jamais vos originaux, et uniquement quand vous cliquez sur la baguette magique d’un souvenir.
      </p>
      <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); if (value.trim()) void save(value.trim()) }}>
        <input type="password" value={value} onChange={(e) => setValue(e.target.value)} placeholder={hasKey ? 'Clé enregistrée · saisir pour remplacer' : 'sk-ant-…'} className="min-w-0 flex-1 rounded-lg border border-line bg-bg px-3 py-1.5 text-[13px] outline-none focus:border-accent" autoComplete="off" />
        <Button type="submit" variant="primary" disabled={!value.trim()}>{saved ? 'Enregistrée' : 'Enregistrer'}</Button>
        {hasKey && <Button onClick={() => void save(null)}>Retirer</Button>}
      </form>
    </section>
  )
}
