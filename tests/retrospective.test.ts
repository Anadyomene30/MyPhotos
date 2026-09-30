import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { existsSync, mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { Library } from '@core/library'
import { frameSize, planSequence } from '@core/export/retrospective'
import { readVideoMetadata } from '@core/media/metadata'
import type { RetroOptions, ServerEvent } from '@shared/types'

const LIB = join(process.cwd(), '.devdata/library')

describe('retrospective planning', () => {
  it('computes even frame sizes', () => {
    expect(frameSize('16:9', 1080)).toEqual({ w: 1920, h: 1080 })
    expect(frameSize('9:16', 1080)).toEqual({ w: 608, h: 1080 })
    expect(frameSize('1:1', 720)).toEqual({ w: 720, h: 720 })
  })
})

describe.runIf(existsSync(LIB))('retrospective rendering', () => {
  let dataDir: string
  let lib: Library
  let music: string
  beforeAll(async () => {
    dataDir = mkdtempSync(join(tmpdir(), 'myphotos-retro-'))
    music = join(dataDir, 'music.m4a')
    execFileSync('ffmpeg', ['-hide_banner', '-loglevel', 'error', '-y', '-f', 'lavfi', '-i', 'sine=frequency=330:duration=6', '-c:a', 'aac', music])
    lib = new Library({ dataDir, autoIndex: false, watch: false, resourcesDir: join(process.cwd(), 'resources') })
    await lib.addSource(LIB)
    await lib.rescanAll()
    await lib.kickIndexer()
  }, 240000)
  afterAll(() => {
    lib.close()
    rmSync(dataDir, { recursive: true, force: true })
  })

  const base: RetroOptions = { source: { type: 'all' }, seconds: 30, pace: 'fast', format: '16:9', resolution: 720, titleCards: true, includeVideos: true, title: 'Nos années', subtitle: '2019 – 2025' }

  it('plans a paced sequence with year cards and a few video excerpts', () => {
    const segs = planSequence(lib.db, base)
    const photos = segs.filter((s) => s.type === 'photo').length
    expect(photos).toBeGreaterThanOrEqual(8)
    expect(segs[0]).toMatchObject({ type: 'title', text: 'Nos années' })
    expect(segs.filter((s) => s.type === 'title').length).toBeGreaterThan(2)
    const total = segs.reduce((a, s) => a + s.seconds, 0)
    expect(total).toBeGreaterThan(20)
    expect(total).toBeLessThan(50)
  })

  it('renders an mp4 with music, at the requested frame, and registers it', async () => {
    const done = new Promise<Extract<ServerEvent, { type: 'retro-done' }>>((resolve) => {
      const on = (e: ServerEvent): void => {
        if (e.type === 'retro-done') {
          lib.off('event', on)
          resolve(e)
        }
      }
      lib.on('event', on)
    })
    lib.startRetrospective({ ...base, seconds: 18, music, format: '9:16' })
    const r = await done
    expect(r.error).toBeUndefined()
    expect(r.ok).toBe(true)
    const m = await readVideoMetadata(r.file!, 'x.mp4', 0)
    expect(m.width).toBe(406)
    expect(m.height).toBe(720)
    expect(m.duration).toBeGreaterThan(12)
    expect(lib.assets.detail(r.assetId!)!.kind).toBe('video')
    const probe = execFileSync('ffprobe', ['-v', 'error', '-show_streams', '-of', 'json', r.file!]).toString()
    expect(probe).toContain('"codec_type": "audio"')
  }, 240000)
})
