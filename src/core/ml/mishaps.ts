/**
 * Shots taken by mistake (floor, ceiling, pocket, finger on the lens, heavy motion blur), recognised zero-shot
 * from the CLIP embedding every photo already has. The counter-prompts describe what such shots get confused with
 * (selfies, parties, night scenes, textures) so a sharp selfie does not read as an accident.
 */

/** Bumped when the prompts change: stored scores are then recomputed from the stored embeddings. */
export const MISHAP_VERSION = 1

/** Score from which a photo is suggested in Cleanup (calibrated on a real library of 8 500 photos). */
export const MISHAP_MIN = 0.9

const BAD = [
  'an accidental photo of the floor',
  'a blurry photo of the ground taken by mistake',
  'a photo taken inside a pocket',
  'an accidental photo, mostly dark and blurry',
  'a photo with a finger covering the lens',
  'a very blurry photo with motion blur',
  'an out of focus photo',
  'an accidental photo of the ceiling'
]

const GOOD = [
  'a selfie', 'a mirror selfie', 'a portrait of a person', 'a group of friends smiling', 'people at a party',
  'a dinner with friends', 'a photo of a building', 'a photo of a painting', 'a photo of a statue',
  'a black and white photo', 'a photo of a concert', 'a photo of a forest', 'a photo of the sky', 'a photo',
  'a good photo', 'a nice photo of people', 'a photo of a landscape', 'a photo of food', 'a photo of a room',
  'a photo of a document', 'a photo taken at night', 'a photo of a city'
]

/** All prompts, accident prompts first. */
export const MISHAP_PROMPTS: readonly string[] = [...BAD, ...GOOD]

/** Probability mass on the accident prompts, from cosines in `MISHAP_PROMPTS` order (softmax at CLIP's scale). */
export function mishapScore(cosines: ArrayLike<number>): number {
  let m = -Infinity
  for (let i = 0; i < cosines.length; i++) m = Math.max(m, cosines[i]!)
  let bad = 0, sum = 0
  for (let i = 0; i < cosines.length; i++) {
    const e = Math.exp((cosines[i]! - m) * 100)
    sum += e
    if (i < BAD.length) bad += e
  }
  return bad / sum
}
