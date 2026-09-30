// Generates a synthetic photo library for development and tests.
// Usage: node scripts/make-fixtures.mjs [outDir] [count]
import { execFileSync } from 'node:child_process'
import { mkdirSync, copyFileSync, existsSync, rmSync, utimesSync } from 'node:fs'
import { join } from 'node:path'
import sharp from 'sharp'

const out = process.argv[2] ?? '.devdata/library'
const count = parseInt(process.argv[3] ?? '160', 10)
rmSync(out, { recursive: true, force: true })
mkdirSync(out, { recursive: true })

let seed = 42
const rand = () => ((seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648)
const pick = (a) => a[Math.floor(rand() * a.length)]
const pad = (n) => String(n).padStart(2, '0')
const exifDate = (d) => `${d.getFullYear()}:${pad(d.getMonth() + 1)}:${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
const ff = (args) => execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', ...args])

const PALETTES = [
  ['#ff9a8b', '#ff6a88', '#ff99ac'], ['#2193b0', '#6dd5ed', '#e0f7fa'], ['#f7971e', '#ffd200', '#fff3b0'],
  ['#134e5e', '#71b280', '#d9f99d'], ['#41295a', '#2f0743', '#c084fc'], ['#ee0979', '#ff6a00', '#fde68a'],
  ['#0f2027', '#203a43', '#2c5364'], ['#56ab2f', '#a8e063', '#ecfccb'], ['#e96443', '#904e95', '#fbcfe8']
]
const PLACES = [
  { lat: 43.4832, lon: -1.5586 }, { lat: 45.764, lon: 4.8357 }, { lat: 48.8566, lon: 2.3522 },
  { lat: 43.7696, lon: 11.2558 }, { lat: 41.3874, lon: 2.1686 }, { lat: 45.9237, lon: 6.8694 }
]

async function makeImage(file, { w, h, date, place, palette, blur = 0, orientation, camera = true, variant = 0 }) {
  const [a, b, c] = palette
  const cx = 30 + rand() * 40, cy = 30 + rand() * 40
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
    <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${a}"/><stop offset="1" stop-color="${b}"/></linearGradient>
    <radialGradient id="r" cx="${cx}%" cy="${cy}%" r="45%"><stop offset="0" stop-color="${c}" stop-opacity="0.95"/><stop offset="1" stop-color="${c}" stop-opacity="0"/></radialGradient></defs>
    <rect width="100%" height="100%" fill="url(#g)"/><rect width="100%" height="100%" fill="url(#r)"/>
    <circle cx="${(cx + variant * 2) * w / 100}" cy="${cy * h / 100 + h * 0.18}" r="${Math.min(w, h) * 0.08}" fill="white" fill-opacity="0.35"/>
    <path d="M0 ${h * 0.78} Q ${w * 0.3} ${h * (0.62 + rand() * 0.1)} ${w * 0.55} ${h * 0.74} T ${w} ${h * 0.7} V ${h} H 0 Z" fill="black" fill-opacity="0.28"/>
  </svg>`
  let img = sharp(Buffer.from(svg))
  if (blur) img = img.blur(blur)
  const exif = { IFD0: {}, IFD2: {}, IFD3: {} }
  if (camera) Object.assign(exif.IFD0, { Make: 'Apple', Model: pick(['iPhone 15 Pro', 'iPhone 13', 'iPhone 16 Pro Max']) })
  exif.IFD2.DateTimeOriginal = exifDate(date)
  exif.IFD2.OffsetTimeOriginal = '+02:00'
  if (place) {
    const dms = (v) => { v = Math.abs(v); const d = Math.floor(v); const m = Math.floor((v - d) * 60); const s = ((v - d) * 60 - m) * 60; return `${d}/1 ${m}/1 ${Math.round(s * 100)}/100` }
    Object.assign(exif.IFD3, { GPSLatitudeRef: place.lat >= 0 ? 'N' : 'S', GPSLatitude: dms(place.lat), GPSLongitudeRef: place.lon >= 0 ? 'E' : 'W', GPSLongitude: dms(place.lon) })
  }
  img = img.jpeg({ quality: 88 }).withExif(exif)
  if (orientation) img = img.withMetadata({ orientation })
  await img.toFile(file)
}

const start = new Date(2019, 5, 1).getTime()
const end = new Date(2025, 8, 1).getTime()
const made = []
let i = 1000
for (let n = 0; n < count; n++) {
  const date = new Date(start + rand() * (end - start))
  const year = date.getFullYear()
  const dir = join(out, String(year), `${year}-${pad(date.getMonth() + 1)}`)
  mkdirSync(dir, { recursive: true })
  const portrait = rand() < 0.3
  const file = join(dir, `IMG_${i++}.JPG`)
  const palette = pick(PALETTES)
  const place = rand() < 0.7 ? pick(PLACES) : null
  await makeImage(file, { w: portrait ? 900 : 1200, h: portrait ? 1200 : 900, date, place, palette })
  made.push({ file, date, palette, place, dir })
  // bursts: 3-5 near-identical shots one second apart
  if (rand() < 0.08) {
    const k = 2 + Math.floor(rand() * 3)
    for (let b = 1; b <= k; b++) {
      const d2 = new Date(date.getTime() + b * 1000)
      await makeImage(join(dir, `IMG_${i++}.JPG`), { w: portrait ? 900 : 1200, h: portrait ? 1200 : 900, date: d2, place, palette, blur: b === k ? 6 : 0, variant: b })
    }
  }
}

// exact duplicates in a messy "copies" folder
mkdirSync(join(out, 'Copies WhatsApp'), { recursive: true })
for (const m of made.slice(0, 8)) copyFileSync(m.file, join(out, 'Copies WhatsApp', `copie de ${m.file.split('/').pop()}`))

// rotated portrait (EXIF orientation 6)
mkdirSync(join(out, 'Divers'), { recursive: true })
await makeImage(join(out, 'Divers', 'IMG_ROT6.JPG'), { w: 1200, h: 900, date: new Date(2024, 6, 14, 18, 3), place: PLACES[0], palette: PALETTES[2], orientation: 6 })

// screenshot
await sharp({ create: { width: 1170, height: 2532, channels: 3, background: '#f2f2f7' } })
  .composite([{ input: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="1170" height="2532"><rect x="60" y="300" width="1050" height="200" rx="30" fill="#fff"/><rect x="60" y="560" width="1050" height="600" rx="30" fill="#fff"/></svg>') }])
  .png().toFile(join(out, 'Divers', 'Capture d’écran 2024-03-02 à 10.12.33.png'))

// HEIC (macOS sips) including a Live Photo pair
if (process.platform === 'darwin') {
  mkdirSync(join(out, 'iPhone'), { recursive: true })
  for (const [k, m] of made.slice(10, 16).entries()) {
    execFileSync('sips', ['-s', 'format', 'heic', m.file, '--out', join(out, 'iPhone', `IMG_${9000 + k}.HEIC`)], { stdio: 'ignore' })
  }
  ff(['-f', 'lavfi', '-i', 'testsrc2=size=1080x1440:rate=30', '-f', 'lavfi', '-i', 'sine=frequency=440', '-t', '2.5',
    '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', 'creation_time=2023-08-12T13:30:12Z', join(out, 'iPhone', 'IMG_9000.MOV')])
}

// videos
mkdirSync(join(out, 'Vidéos'), { recursive: true })
const srcs = ['testsrc2', 'mandelbrot', 'smptehdbars', 'rgbtestsrc']
for (let v = 0; v < 4; v++) {
  const d = new Date(start + rand() * (end - start))
  ff(['-f', 'lavfi', '-i', `${srcs[v]}=size=1280x720:rate=30`, '-f', 'lavfi', '-i', `sine=frequency=${300 + v * 100}`, '-t', String(8 + v * 4),
    '-c:v', 'libx264', '-preset', 'veryfast', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-metadata', `creation_time=${d.toISOString()}`, join(out, 'Vidéos', `VID_${2000 + v}.mp4`)])
}

// a file without EXIF: date from filename
await sharp({ create: { width: 800, height: 600, channels: 3, background: '#3b82f6' } }).jpeg().toFile(join(out, 'Divers', 'WhatsApp Image 2022-12-24 at 19.45.10.jpeg'))
// a file without any date clue: mtime
const noDate = join(out, 'Divers', 'scan_famille.png')
await sharp({ create: { width: 640, height: 480, channels: 3, background: '#a16207' } }).png().toFile(noDate)
utimesSync(noDate, new Date(2020, 0, 5), new Date(2020, 0, 5))

console.log(`fixtures written to ${out}`)
