import { getLocale, tIn, type Locale } from '@shared/i18n'

/** Zero-shot categories: French labels (translated per locale), English CLIP prompts (CLIP understands English far better). */
export interface Category {
  id: string
  /** Display label in the current language */
  readonly label: string
  /** Display label in a given language (search text indexes both) */
  labelIn(locale: Locale): string
  prompts: string[]
}

const RAW: Array<Omit<Category, 'label'>> = [
  { id: 'people', labelIn: (l) => tIn(l, 'Personnes'), prompts: ['a photo of people', 'a portrait of a person'] },
  { id: 'selfie', labelIn: (l) => tIn(l, 'Selfies'), prompts: ['a selfie'] },
  { id: 'kids', labelIn: (l) => tIn(l, 'Enfants'), prompts: ['a photo of a child', 'a photo of a baby'] },
  { id: 'pets', labelIn: (l) => tIn(l, 'Animaux'), prompts: ['a photo of a dog', 'a photo of a cat', 'a photo of an animal'] },
  { id: 'food', labelIn: (l) => tIn(l, 'Nourriture'), prompts: ['a photo of food on a plate', 'a photo of a meal', 'a photo of a drink'] },
  { id: 'landscape', labelIn: (l) => tIn(l, 'Paysages'), prompts: ['a landscape photo', 'a photo of nature'] },
  { id: 'beach', labelIn: (l) => tIn(l, 'Plage et mer'), prompts: ['a photo of a beach', 'a photo of the sea'] },
  { id: 'mountain', labelIn: (l) => tIn(l, 'Montagne'), prompts: ['a photo of mountains'] },
  { id: 'snow', labelIn: (l) => tIn(l, 'Neige'), prompts: ['a photo of snow', 'a photo of skiing'] },
  { id: 'city', labelIn: (l) => tIn(l, 'Villes'), prompts: ['a photo of a city street', 'a photo of buildings'] },
  { id: 'architecture', labelIn: (l) => tIn(l, 'Monuments'), prompts: ['a photo of a monument', 'a photo of a church', 'a photo of a castle'] },
  { id: 'night', labelIn: (l) => tIn(l, 'Nuit'), prompts: ['a photo taken at night'] },
  { id: 'sunset', labelIn: (l) => tIn(l, 'Couchers de soleil'), prompts: ['a photo of a sunset', 'a photo of a sunrise'] },
  { id: 'flowers', labelIn: (l) => tIn(l, 'Fleurs et plantes'), prompts: ['a photo of flowers', 'a photo of plants'] },
  { id: 'party', labelIn: (l) => tIn(l, 'Fêtes'), prompts: ['a photo of a party', 'a photo of a wedding', 'a photo of a birthday cake'] },
  { id: 'sport', labelIn: (l) => tIn(l, 'Sport'), prompts: ['a photo of a sports game', 'a photo of people doing sport'] },
  { id: 'vehicle', labelIn: (l) => tIn(l, 'Véhicules'), prompts: ['a photo of a car', 'a photo of a motorcycle', 'a photo of a boat', 'a photo of an airplane'] },
  { id: 'art', labelIn: (l) => tIn(l, 'Art et musées'), prompts: ['a photo of a painting', 'a photo of a museum', 'a photo of a sculpture'] },
  { id: 'document', labelIn: (l) => tIn(l, 'Documents'), prompts: ['a photo of a document', 'a photo of text', 'a receipt', 'a whiteboard'] },
  { id: 'screenshot', labelIn: (l) => tIn(l, 'Captures d’écran'), prompts: ['a screenshot of a phone screen', 'a screenshot of an app'] },
  { id: 'interior', labelIn: (l) => tIn(l, 'Intérieurs'), prompts: ['a photo of a room', 'a photo of a living room'] },
  { id: 'concert', labelIn: (l) => tIn(l, 'Concerts'), prompts: ['a photo of a concert', 'a photo of a stage with lights'] }
]

export const CATEGORIES: Category[] = RAW.map((c) => ({
  ...c,
  get label() {
    return c.labelIn(getLocale())
  }
}))

/** Softmax over category prompt similarities (temperature 100, as CLIP's logit scale). */
export function classify(scores: Float32Array[], catIndex: number[][], minProb = 0.3, maxLabels = 3): Array<{ id: string; score: number }> {
  // scores[i]: cosine for prompt i; catIndex[c]: prompt indices of category c
  const perCat = catIndex.map((idx) => Math.max(...idx.map((i) => scores[i]![0]!)))
  const m = Math.max(...perCat)
  const exps = perCat.map((s) => Math.exp((s - m) * 100))
  const sum = exps.reduce((a, b) => a + b, 0)
  return exps
    .map((e, c) => ({ id: CATEGORIES[c]!.id, score: e / sum }))
    .filter((x) => x.score >= minProb)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxLabels)
}
