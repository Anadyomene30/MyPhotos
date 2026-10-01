#!/usr/bin/env node
// Lists user-visible French text that is not wrapped in t()/tn()/plural() yet.
// Usage: node scripts/i18n-scan.mjs <file-or-dir>...   (heuristic: review each hit)
import { readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'

const walk = (p) => (statSync(p).isDirectory() ? readdirSync(p).flatMap((f) => walk(join(p, f))) : /\.tsx?$/.test(p) && !p.endsWith('.d.ts') ? [p] : [])
const files = process.argv.slice(2).flatMap(walk)
const FR = /[A-Za-zÀ-ÿ]{2,}/
const ACCENT = /[À-ÿ’]/
let total = 0
for (const f of files) {
  const lines = readFileSync(f, 'utf8').split('\n')
  const hits = []
  lines.forEach((line, i) => {
    if (/^\s*(\/\/|\*|\/\*)/.test(line) || /\bimport\b/.test(line)) return
    // JSX text between tags: >Texte<
    for (const m of line.matchAll(/>([^<>{}]+)</g)) if (FR.test(m[1]) && m[1].trim()) hits.push([i + 1, m[1].trim()])
    // JSX text running to the end of the line
    const tail = /^\s+([^<>{}=;()]*[A-Za-zÀ-ÿ][^<>{}=;()]*)$/.exec(line)
    if (tail && !/^\s*[a-z]+[A-Z]?\w*\s*[:(]/.test(line) && /[a-zà-ÿ] [a-zà-ÿ]|[À-ÿ’]/.test(tail[1])) hits.push([i + 1, tail[1].trim()])
    // visible attributes
    for (const m of line.matchAll(/\b(label|title|placeholder|aria-label|alt|confirmLabel|message|subtitle)=["']([^"']+)["']/g)) if (FR.test(m[2])) hits.push([i + 1, `${m[1]}="${m[2]}"`])
    // quoted literals with accents or spaces outside t(...)
    for (const m of line.matchAll(/(^|[^\w])(['`])((?:(?!\2)[^\\]|\\.)*)\2/g)) {
      const s = m[3]
      const before = line.slice(0, m.index + m[1].length)
      if (/\b(t|tn|plural|tIn\([^,]+,)\(\s*$|\b(tn|plural)\([^,]+,\s*('[^']*',\s*)?$/.test(before)) continue
      if (/className|import|from |\.(get|set)Item|querySelector|addEventListener|data-|key=/.test(before.slice(-40))) continue
      if (/(^|\s)(flex|grid|absolute|relative|px-\d|py-\d|text-|bg-|rounded|items-|gap-|w-|h-|size-|opacity-|hover:|font-)/.test(s)) continue
      if (ACCENT.test(s) || (/^[A-ZÀ-Ý][a-zà-ÿ]+(\s[a-zà-ÿ’]+)+/.test(s) && !/[{}<>=;]/.test(s))) hits.push([i + 1, s])
    }
  })
  if (hits.length) {
    console.log(`\n${f}`)
    for (const [n, s] of hits) console.log(`  ${n}: ${s}`)
    total += hits.length
  }
}
console.log(`\n${total} candidate(s)`)
