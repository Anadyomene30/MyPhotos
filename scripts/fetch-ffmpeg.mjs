#!/usr/bin/env node
// Downloads static ffmpeg + ffprobe (>= 8.1, needed for iPhone HEIC grids) into resources/ffmpeg/<platform>-<arch>/,
// where electron-builder picks them up. Sources: Martin Riedl's signed macOS builds and BtbN's Windows builds (GPL).
// Every archive is checked against the SHA-256 published next to it.
// Usage: node scripts/fetch-ffmpeg.mjs [darwin-arm64] [win32-x64]   (default: both)   --force to re-download
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const ROOT = join(import.meta.dirname, '..', 'resources', 'ffmpeg')
const MIN = [8, 1]

async function get(url) {
  const r = await fetch(url, { redirect: 'follow' })
  if (!r.ok) throw new Error(`${r.status} ${url}`)
  return { buf: Buffer.from(await r.arrayBuffer()), url: r.url }
}
const sha256 = (b) => createHash('sha256').update(b).digest('hex')
function check(buf, expected, name) {
  const got = sha256(buf)
  if (got !== expected) throw new Error(`checksum mismatch for ${name}: ${got} != ${expected}`)
}
function unzip(buf, dir) {
  const zip = join(dir, 'a.zip')
  writeFileSync(zip, buf)
  // bsdtar reads zip archives on macOS and Windows 10+
  execFileSync(process.platform === 'win32' ? 'tar' : 'unzip', process.platform === 'win32' ? ['-xf', zip, '-C', dir] : ['-q', '-o', zip, '-d', dir])
}
function find(dir, name) {
  for (const f of readdirSync(dir)) {
    const p = join(dir, f)
    if (statSync(p).isDirectory()) {
      const r = find(p, name)
      if (r) return r
    } else if (f === name) return p
  }
  return null
}

const TARGETS = {
  'darwin-arm64': async (tmp) => {
    for (const tool of ['ffmpeg', 'ffprobe']) {
      const { buf, url } = await get(`https://ffmpeg.martin-riedl.de/redirect/latest/macos/arm64/release/${tool}.zip`)
      const sum = (await get(`${url}.sha256`)).buf.toString().trim().split(/\s+/)[0]
      check(buf, sum, `${tool}.zip`)
      unzip(buf, tmp)
      console.log(`  ${tool}: ${url}`)
    }
    return ['ffmpeg', 'ffprobe']
  },
  'win32-x64': async (tmp) => {
    const base = 'https://github.com/BtbN/FFmpeg-Builds/releases/download/latest'
    const name = 'ffmpeg-n9.0-latest-win64-gpl-9.0.zip'
    const { buf } = await get(`${base}/${name}`)
    const sums = (await get(`${base}/checksums.sha256`)).buf.toString()
    const line = sums.split('\n').find((l) => l.trim().endsWith(name))
    if (!line) throw new Error(`no checksum for ${name}`)
    check(buf, line.trim().split(/\s+/)[0], name)
    unzip(buf, tmp)
    console.log(`  ${base}/${name}`)
    return ['ffmpeg.exe', 'ffprobe.exe']
  }
}

const args = process.argv.slice(2)
const force = args.includes('--force')
const wanted = args.filter((a) => !a.startsWith('--'))
for (const target of wanted.length ? wanted : Object.keys(TARGETS)) {
  const fetcher = TARGETS[target]
  if (!fetcher) throw new Error(`unknown target ${target} (known: ${Object.keys(TARGETS).join(', ')})`)
  const out = join(ROOT, target)
  const exe = target.startsWith('win32') ? '.exe' : ''
  if (!force && existsSync(join(out, `ffmpeg${exe}`)) && existsSync(join(out, `ffprobe${exe}`))) {
    console.log(`${target}: already present`)
    continue
  }
  console.log(`${target}: downloading`)
  const tmp = mkdtempSync(join(tmpdir(), 'myphotos-ffmpeg-'))
  try {
    const files = await fetcher(tmp)
    mkdirSync(out, { recursive: true })
    for (const f of files) {
      const src = find(tmp, f)
      if (!src) throw new Error(`${f} not found in archive`)
      rmSync(join(out, f), { force: true })
      renameSync(src, join(out, f))
      chmodSync(join(out, f), 0o755)
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
  if (target === `${process.platform}-${process.arch}`) {
    const v = execFileSync(join(out, `ffmpeg${exe}`), ['-version']).toString().split('\n')[0]
    const m = /version n?(\d+)\.(\d+)/.exec(v)
    if (!m || +m[1] < MIN[0] || (+m[1] === MIN[0] && +m[2] < MIN[1])) throw new Error(`${target}: ffmpeg too old: ${v}`)
    console.log(`  ${v}`)
  }
}
