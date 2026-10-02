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

/** Probability mass on the first `nBad` prompts (softmax at CLIP's scale). */
function badShare(cosines: ArrayLike<number>, nBad: number): number {
  let m = -Infinity
  for (let i = 0; i < cosines.length; i++) m = Math.max(m, cosines[i]!)
  let bad = 0, sum = 0
  for (let i = 0; i < cosines.length; i++) {
    const e = Math.exp((cosines[i]! - m) * 100)
    sum += e
    if (i < nBad) bad += e
  }
  return bad / sum
}

/** Probability mass on the accident prompts, from cosines in `MISHAP_PROMPTS` order. */
export function mishapScore(cosines: ArrayLike<number>): number {
  return badShare(cosines, BAD.length)
}

// ------------------------------------------------------------- screenshots taken by mistake

/** Bumped when the screenshot prompts change. */
export const SCREEN_MISHAP_VERSION = 1

/** Score from which a screenshot is suggested. Kept high: on a real library, lower scores mix in screenshots of
 * black-and-white generative art, while the keyboard and loading-screen captures scored 0.79 and above. */
export const SCREEN_MISHAP_MIN = 0.7

const SCREEN_BAD = [
  'a screenshot of a phone home screen with app icons',
  'a screenshot of a phone lock screen with the time',
  'a black screenshot',
  'a blank screenshot',
  'a screenshot of a loading screen',
  'a screenshot of a phone keyboard',
  'a screenshot of the phone control center',
  'a screenshot of the camera app'
]

const SCREEN_GOOD = [
  'black and white abstract art', 'a fractal', 'a kaleidoscope pattern', 'a digital artwork', 'a screenshot of a video call',
  'a selfie', 'a painting', 'a photo of nature', 'a photo of people', 'a screenshot of a text conversation', 'a screenshot of a map',
  'a screenshot of a web page', 'a screenshot of a photo', 'a screenshot of a ticket or receipt', 'a screenshot of a social media post',
  'a screenshot of a document', 'a screenshot of a video game', 'a screenshot of a recipe', 'a screenshot of an email',
  'a screenshot of a video', 'a screenshot of an app', 'a screenshot'
]

/** All screenshot prompts, mistakes first. */
export const SCREEN_MISHAP_PROMPTS: readonly string[] = [...SCREEN_BAD, ...SCREEN_GOOD]

/** Probability that a screenshot was taken by mistake (home or lock screen, keyboard, loading screen…). */
export function screenMishapScore(cosines: ArrayLike<number>): number {
  return badShare(cosines, SCREEN_BAD.length)
}

/** Contrast below which a screenshot is a single flat colour (all black, all white): measured, not guessed. */
export const BLANK_SCREENSHOT_CONTRAST = 0.01
