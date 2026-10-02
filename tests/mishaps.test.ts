import { describe, expect, it } from 'vitest'
import { MISHAP_MIN, MISHAP_PROMPTS, mishapScore, SCREEN_MISHAP_MIN, SCREEN_MISHAP_PROMPTS, screenMishapScore } from '@core/ml/mishaps'

const at = (i: number, top: number): number[] => MISHAP_PROMPTS.map((_, j) => (j === i ? top : 0.2))

describe('mishap score', () => {
  it('passes the threshold when an accident prompt clearly wins', () => {
    expect(mishapScore(at(0, 0.3))).toBeGreaterThan(MISHAP_MIN)
  })

  it('stays low when an ordinary prompt wins', () => {
    expect(mishapScore(at(MISHAP_PROMPTS.length - 1, 0.3))).toBeLessThan(0.1)
  })

  it('is a probability', () => {
    const s = mishapScore(MISHAP_PROMPTS.map(() => 0.2))
    expect(s).toBeGreaterThan(0)
    expect(s).toBeLessThan(1)
  })
})

describe('screenshot mishap score', () => {
  const atS = (i: number, top: number): number[] => SCREEN_MISHAP_PROMPTS.map((_, j) => (j === i ? top : 0.2))

  it('passes the threshold when a mistaken-screen prompt clearly wins', () => {
    expect(screenMishapScore(atS(0, 0.3))).toBeGreaterThan(SCREEN_MISHAP_MIN)
  })

  it('stays low when an ordinary screenshot prompt wins', () => {
    expect(screenMishapScore(atS(SCREEN_MISHAP_PROMPTS.length - 1, 0.3))).toBeLessThan(0.1)
  })
})

describe('failed screenshots in Cleanup', () => {
  it('suggests a screenshot of a single flat colour, not an ordinary one, and leaves both unticked lists apart', async () => {
    const { mkdtempSync, rmSync, mkdirSync } = await import('node:fs')
    const { tmpdir } = await import('node:os')
    const { join } = await import('node:path')
    const sharp = (await import('sharp')).default
    const { Library } = await import('@core/library')
    const root = mkdtempSync(join(tmpdir(), 'myphotos-shots-'))
    const lib0 = join(root, 'lib')
    mkdirSync(lib0)
    // two old screenshots: one all black, one with content
    await sharp({ create: { width: 390, height: 844, channels: 3, background: '#000' } }).png().toFile(join(lib0, 'Screenshot 2020-01-01 at 10.00.00.png'))
    const svg = Buffer.from('<svg width="390" height="844"><rect width="390" height="844" fill="#fff"/><rect x="20" y="60" width="350" height="80" fill="#36c"/><text x="30" y="300" font-size="40">Bonjour</text></svg>')
    await sharp(svg).png().toFile(join(lib0, 'Screenshot 2020-01-02 at 10.00.00.png'))
    const lib = new Library({ dataDir: join(root, 'data'), autoIndex: false, watch: false })
    try {
      await lib.addSource(lib0)
      await lib.rescanAll()
      await lib.kickIndexer()
      const r = await lib.cleanupReport()
      const byId = new Map(r.suggestions.map((c) => [c.id, c.items.map((i) => i.name)]))
      expect(byId.get('failedScreenshots')).toEqual(['Screenshot 2020-01-01 at 10.00.00.png'])
      expect(byId.get('screenshots')).toEqual(['Screenshot 2020-01-02 at 10.00.00.png'])
    } finally {
      lib.close()
      rmSync(root, { recursive: true, force: true })
    }
  }, 120000)
})
