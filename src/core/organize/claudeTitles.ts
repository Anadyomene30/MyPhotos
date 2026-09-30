import { readFile } from 'node:fs/promises'
import Anthropic from '@anthropic-ai/sdk'

export interface TitleRequest {
  kind: string
  currentTitle: string
  subtitle: string | null
  places: string[]
  people: string[]
  dateRange: string
  count: number
  /** up to 6 small thumbnails (WebP/JPEG files) */
  thumbs: string[]
}

export interface TitleResult {
  title: string
  subtitle: string
  captions: string[]
}

/**
 * Optional cloud enrichment: asks Claude for an evocative title, a subtitle and short captions.
 * Only small thumbnails are sent, never originals. Disabled unless the user stored an API key.
 */
export async function enrichWithClaude(apiKey: string, req: TitleRequest): Promise<TitleResult> {
  const client = new Anthropic({ apiKey })
  const images: Anthropic.Beta.BetaImageBlockParam[] = []
  for (const f of req.thumbs.slice(0, 6)) {
    const data = (await readFile(f)).toString('base64')
    images.push({ type: 'image', source: { type: 'base64', media_type: f.endsWith('.webp') ? 'image/webp' : 'image/jpeg', data } })
  }
  const facts = [
    `Type de souvenir : ${req.kind}`,
    `Titre actuel : ${req.currentTitle}`,
    req.subtitle ? `Sous-titre actuel : ${req.subtitle}` : '',
    `Période : ${req.dateRange}`,
    req.places.length ? `Lieux : ${req.places.join(', ')}` : '',
    req.people.length ? `Personnes : ${req.people.join(', ')}` : '',
    `${req.count} photos au total`
  ].filter(Boolean).join('\n')

  const response = await client.beta.messages.create({
    model: 'claude-opus-5-5',
    max_tokens: 1024,
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    output_config: { effort: 'low' },
    system:
      'Tu composes des titres de livres photo pour une photothèque familiale française. Réponds uniquement avec un objet JSON ' +
      '{"title": string, "subtitle": string, "captions": string[]} : un titre évocateur et sobre (2 à 6 mots, sans point, sans guillemets), ' +
      'un sous-titre d’une phrase courte, et une légende courte (5 à 12 mots) par image reçue, dans l’ordre. Français uniquement, jamais de nom de personne inventé.',
    messages: [{ role: 'user', content: [...images, { type: 'text', text: facts }] }]
  })
  if (response.stop_reason === 'refusal') throw new Error('Claude a refusé cette demande')
  const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === 'text').map((b) => b.text).join('')
  const m = /\{[\s\S]*\}/.exec(text)
  if (!m) throw new Error('Réponse inattendue')
  const parsed = JSON.parse(m[0]) as Partial<TitleResult>
  return {
    title: String(parsed.title ?? req.currentTitle).trim().slice(0, 80),
    subtitle: String(parsed.subtitle ?? req.subtitle ?? '').trim().slice(0, 140),
    captions: Array.isArray(parsed.captions) ? parsed.captions.map((c) => String(c).slice(0, 120)) : []
  }
}
