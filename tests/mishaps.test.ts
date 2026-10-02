import { describe, expect, it } from 'vitest'
import { MISHAP_MIN, MISHAP_PROMPTS, mishapScore } from '@core/ml/mishaps'

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
