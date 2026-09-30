import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { Search, X } from 'lucide-react'
import { useMlStatus } from '@/api/hooks'
import { useUi } from '@/store'

/** Toolbar search: file names, places, people, categories, and semantic search when CLIP is installed. */
export function SearchBar() {
  const search = useUi((s) => s.search)
  const setSearch = useUi((s) => s.setSearch)
  const { data: ml } = useMlStatus()
  const [value, setValue] = useState(search)
  const ref = useRef<HTMLInputElement>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => setValue(search), [search])

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if ((e.metaKey || e.ctrlKey) && (e.key === 'f' || e.key === 'k')) {
        e.preventDefault()
        ref.current?.focus()
        ref.current?.select()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const commit = (v: string): void => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setSearch(v), v ? 350 : 0)
  }
  const semantic = ml?.enabled && ml.running.clip

  return (
    <div className={clsx('no-drag relative flex h-[30px] items-center rounded-lg bg-hover transition-[width]', value ? 'w-64' : 'w-52 focus-within:w-64')}>
      <Search className="pointer-events-none absolute left-2.5 size-3.5 text-faint" />
      <input
        ref={ref}
        value={value}
        onChange={(e) => {
          setValue(e.target.value)
          commit(e.target.value)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setValue('')
            setSearch('')
            ref.current?.blur()
          }
          if (e.key === 'Enter') setSearch(value)
          e.stopPropagation()
        }}
        placeholder={semantic ? 'Rechercher : « plage 2019 », « chien »…' : 'Rechercher'}
        className="h-full w-full bg-transparent pr-7 pl-8 text-[12.5px] outline-none placeholder:text-faint"
        aria-label="Rechercher"
      />
      {value && (
        <button
          onClick={() => {
            setValue('')
            setSearch('')
          }}
          className="absolute right-1.5 grid size-5 place-items-center rounded-full text-faint hover:bg-line hover:text-fg"
          aria-label="Effacer"
        >
          <X className="size-3" />
        </button>
      )}
    </div>
  )
}
