import { describe, expect, it } from 'vitest'
import { join } from 'node:path'
import { existsSync } from 'node:fs'
import { dateFromFilename, fallbackDate, periodFromPath, parseDateString, readImageMetadata, readVideoMetadata } from '@core/media/metadata'
import { openImage } from '@core/media/decode'
import { looksLikeScreenshot } from '@core/media/kinds'

const LIB = join(process.cwd(), '.devdata/library')
const hasFixtures = existsSync(LIB)

describe('date parsing', () => {
  it('parses EXIF and ISO dates with offsets', () => {
    expect(parseDateString('2023:08:12 15:30:12')).toMatchObject({ wall: { y: 2023, mo: 8, d: 12, h: 15 }, offset: null })
    expect(parseDateString('2023-08-12T15:30:12+0200')?.offset).toBe(120)
    expect(parseDateString('2023-08-12T13:30:12.000000Z')?.offset).toBe(0)
    expect(parseDateString('0000:00:00 00:00:00')).toBeNull()
  })
  it('reads dates from common file names', () => {
    expect(dateFromFilename('IMG_20230812_153012.jpg')).toMatchObject({ y: 2023, mo: 8, d: 12, h: 15, mi: 30, s: 12 })
    expect(dateFromFilename('PXL_20240101_000102345.jpg')).toMatchObject({ y: 2024, mo: 1, d: 1 })
    expect(dateFromFilename('WhatsApp Image 2022-12-24 at 19.45.10.jpeg')).toMatchObject({ y: 2022, mo: 12, d: 24 })
    expect(dateFromFilename('Capture d’écran 2024-03-02 à 10.12.33.png')).toMatchObject({ y: 2024, mo: 3, d: 2, h: 10, mi: 12, s: 33 })
    expect(dateFromFilename('WhatsApp Image 2022-12-24 at 19.45.10.jpeg')).toMatchObject({ h: 19, mi: 45 })
    expect(dateFromFilename('IMG_1234.JPG')).toBeNull()
  })
  it('uses the folder period when the file date disagrees', () => {
    expect(periodFromPath('2019/2019-03')).toEqual({ start: new Date(2019, 2, 1).getTime(), end: new Date(2019, 3, 1).getTime() })
    expect(periodFromPath('Albums/2018-12-24 Noël')?.start).toBe(new Date(2018, 11, 24).getTime())
    expect(periodFromPath('Vacances 2017')?.start).toBe(new Date(2017, 0, 1).getTime())
    expect(periodFromPath('Divers')).toBeNull()
    const inside = new Date(2019, 2, 31, 18).getTime()
    expect(fallbackDate('IMG_1.JPG', '2019/2019-03', inside)).toMatchObject({ takenAt: inside, source: 'mtime' })
    expect(fallbackDate('IMG_1.JPG', '2019/2019-03', new Date(2023, 5, 1).getTime())).toMatchObject({ day: '2019-03-01', source: 'folder' })
  })
  it('detects screenshots', () => {
    expect(looksLikeScreenshot('Capture d’écran 2024-03-02 à 10.12.33.png', 'png', false)).toBe(true)
    expect(looksLikeScreenshot('Screenshot_20240302.png', 'png', false)).toBe(true)
    expect(looksLikeScreenshot('IMG_1234.JPG', 'jpg', true)).toBe(false)
  })
})

describe.runIf(hasFixtures)('fixtures', () => {
  it('reads EXIF date, offset, GPS and camera from JPEG', async () => {
    const m = await readImageMetadata(join(LIB, 'Divers/IMG_ROT6.JPG'), 'IMG_ROT6.JPG', 'jpg', 0)
    expect(m.dateSource).toBe('exif')
    expect(m.day).toBe('2024-07-14')
    expect(m.tzOffset).toBe(120)
    expect(m.orientation).toBe(6)
    expect(m.lat).toBeCloseTo(43.4832, 3)
    expect(m.lon).toBeCloseTo(-1.5586, 3)
    expect(m.make).toBe('Apple')
  })
  it('reads HEIC metadata and decodes the tile grid at full size', async () => {
    const f = join(LIB, 'iPhone/IMG_9001.HEIC')
    if (!existsSync(f)) return
    const m = await readImageMetadata(f, 'IMG_9001.HEIC', 'heic', 0)
    expect(m.dateSource).toBe('exif')
    const img = await openImage({ path: f, ext: 'heic', kind: 'photo', orientation: m.orientation, duration: null })
    const { info } = await img.toBuffer({ resolveWithObject: true })
    expect(Math.max(info.width, info.height)).toBeGreaterThan(512)
  })
  it('reads video duration, size and creation date', async () => {
    const m = await readVideoMetadata(join(LIB, 'Vidéos/VID_2000.mp4'), 'VID_2000.mp4', 0)
    expect(m.duration).toBeCloseTo(8, 0)
    expect(m.width).toBe(1280)
    expect(m.dateSource).toBe('video')
  })
  it('falls back to the file name date', async () => {
    const m = await readImageMetadata(join(LIB, 'Divers/WhatsApp Image 2022-12-24 at 19.45.10.jpeg'), 'WhatsApp Image 2022-12-24 at 19.45.10.jpeg', 'jpeg', 0)
    expect(m.dateSource).toBe('filename')
    expect(m.day).toBe('2022-12-24')
  })
  it('applies EXIF orientation when decoding', async () => {
    const img = await openImage({ path: join(LIB, 'Divers/IMG_ROT6.JPG'), ext: 'jpg', kind: 'photo', orientation: 6, duration: null })
    const { info } = await img.toBuffer({ resolveWithObject: true })
    expect(info.height).toBeGreaterThan(info.width)
  })
})
