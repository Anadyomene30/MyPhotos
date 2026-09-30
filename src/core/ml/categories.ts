/** Zero-shot categories: French labels, English CLIP prompts (CLIP understands English far better). */
export interface Category {
  id: string
  label: string
  prompts: string[]
}

export const CATEGORIES: Category[] = [
  { id: 'people', label: 'Personnes', prompts: ['a photo of people', 'a portrait of a person'] },
  { id: 'selfie', label: 'Selfies', prompts: ['a selfie'] },
  { id: 'kids', label: 'Enfants', prompts: ['a photo of a child', 'a photo of a baby'] },
  { id: 'pets', label: 'Animaux', prompts: ['a photo of a dog', 'a photo of a cat', 'a photo of an animal'] },
  { id: 'food', label: 'Nourriture', prompts: ['a photo of food on a plate', 'a photo of a meal', 'a photo of a drink'] },
  { id: 'landscape', label: 'Paysages', prompts: ['a landscape photo', 'a photo of nature'] },
  { id: 'beach', label: 'Plage et mer', prompts: ['a photo of a beach', 'a photo of the sea'] },
  { id: 'mountain', label: 'Montagne', prompts: ['a photo of mountains'] },
  { id: 'snow', label: 'Neige', prompts: ['a photo of snow', 'a photo of skiing'] },
  { id: 'city', label: 'Villes', prompts: ['a photo of a city street', 'a photo of buildings'] },
  { id: 'architecture', label: 'Monuments', prompts: ['a photo of a monument', 'a photo of a church', 'a photo of a castle'] },
  { id: 'night', label: 'Nuit', prompts: ['a photo taken at night'] },
  { id: 'sunset', label: 'Couchers de soleil', prompts: ['a photo of a sunset', 'a photo of a sunrise'] },
  { id: 'flowers', label: 'Fleurs et plantes', prompts: ['a photo of flowers', 'a photo of plants'] },
  { id: 'party', label: 'Fêtes', prompts: ['a photo of a party', 'a photo of a wedding', 'a photo of a birthday cake'] },
  { id: 'sport', label: 'Sport', prompts: ['a photo of a sports game', 'a photo of people doing sport'] },
  { id: 'vehicle', label: 'Véhicules', prompts: ['a photo of a car', 'a photo of a motorcycle', 'a photo of a boat', 'a photo of an airplane'] },
  { id: 'art', label: 'Art et musées', prompts: ['a photo of a painting', 'a photo of a museum', 'a photo of a sculpture'] },
  { id: 'document', label: 'Documents', prompts: ['a photo of a document', 'a photo of text', 'a receipt', 'a whiteboard'] },
  { id: 'screenshot', label: 'Captures d’écran', prompts: ['a screenshot of a phone screen', 'a screenshot of an app'] },
  { id: 'interior', label: 'Intérieurs', prompts: ['a photo of a room', 'a photo of a living room'] },
  { id: 'concert', label: 'Concerts', prompts: ['a photo of a concert', 'a photo of a stage with lights'] }
]

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
