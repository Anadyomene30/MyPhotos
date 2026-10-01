import { describe, expect, it } from 'vitest'
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { en } from '@shared/i18n/en'
import { isPlural, resolveLocale, setLocale, t, tn } from '@shared/i18n'

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((f) => {
    const p = join(dir, f)
    return statSync(p).isDirectory() ? files(p) : /\.tsx?$/.test(f) && !f.endsWith('.d.ts') ? [p] : []
  })
}

const LIT = `'((?:[^'\\\\]|\\\\.)*)'`
const PATTERNS = [
  new RegExp(`\\bt\\(\\s*${LIT}`, 'g'),
  new RegExp(`\\btIn\\([^,()]+,\\s*${LIT}`, 'g'),
  new RegExp(`\\b(?:tn|plural)\\([^,]+,\\s*${LIT}\\s*,\\s*${LIT}`, 'g')
]

/** Every French string passed to t / tn / plural / tIn, with the file it comes from. */
export function usedKeys(): Map<string, string> {
  const keys = new Map<string, string>()
  for (const f of ['src/renderer/src', 'src/core', 'src/server', 'src/shared'].flatMap((d) => files(join(process.cwd(), d)))) {
    if (f.includes(`${join('shared', 'i18n')}`)) continue
    const src = readFileSync(f, 'utf8')
    for (const re of PATTERNS) {
      for (const m of src.matchAll(re)) {
        for (const k of m.slice(1)) if (k !== undefined) keys.set(k.replace(/\\'/g, "'"), f.replace(process.cwd() + '/', ''))
      }
    }
  }
  return keys
}

const vars = (s: string): string[] => [...s.matchAll(/\{(\w+)\}/g)].map((m) => m[1]!).sort()

describe('i18n', () => {
  it('has an English translation for every French string used', () => {
    const missing = [...usedKeys()].filter(([k]) => !(k in en)).map(([k, f]) => `${f}: ${k}`)
    expect(missing).toEqual([])
  })

  it('keeps the same {variables} in translations', () => {
    const bad = Object.entries(en).filter(([k, v]) => vars(k).join() !== vars(v).join()).map(([k]) => k)
    expect(bad).toEqual([])
  })

  it('translates, fills variables and picks plural forms per language', () => {
    expect(resolveLocale('auto', 'fr-CA')).toEqual({ locale: 'fr', tag: 'fr-CA' })
    expect(resolveLocale('auto', 'en-GB').locale).toBe('en')
    expect(resolveLocale('fr', 'en-US')).toEqual({ locale: 'fr', tag: 'fr-FR' })
    setLocale('en')
    expect(t('Hier')).toBe('Yesterday')
    expect(t('Texte sans traduction')).toBe('Texte sans traduction')
    expect(isPlural(0)).toBe(true)
    setLocale('fr')
    expect(isPlural(0)).toBe(false)
    expect(tn(1, '{n} chose', '{n} choses')).toBe('1 chose')
    expect(tn(1200, '{n} chose', '{n} choses')).toBe('1 200 choses')
  })
})
