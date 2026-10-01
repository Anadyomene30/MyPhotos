import { t } from '../i18n'
/** Non-destructive photo adjustments. Every value defaults to 0 (neutral). */
export interface PhotoEdit {
  version: 1
  light: { exposure: number; contrast: number; highlights: number; shadows: number; whites: number; blacks: number; brilliance: number }
  color: { temperature: number; tint: number; vibrance: number; saturation: number; mono: boolean }
  detail: { sharpness: number; clarity: number; noise: number }
  effects: { vignette: number; grain: number; fade: number }
  geometry: {
    /** quarter turns clockwise */
    rotate: 0 | 1 | 2 | 3
    /** fine rotation in degrees, -45..45 */
    straighten: number
    flipH: boolean
    /** normalized crop in the rotated image, null = full frame */
    crop: { x: number; y: number; w: number; h: number } | null
  }
  /** preset applied, for display only */
  filter?: string | null
}

export const NEUTRAL: PhotoEdit = {
  version: 1,
  light: { exposure: 0, contrast: 0, highlights: 0, shadows: 0, whites: 0, blacks: 0, brilliance: 0 },
  color: { temperature: 0, tint: 0, vibrance: 0, saturation: 0, mono: false },
  detail: { sharpness: 0, clarity: 0, noise: 0 },
  effects: { vignette: 0, grain: 0, fade: 0 },
  geometry: { rotate: 0, straighten: 0, flipH: false, crop: null },
  filter: null
}

export function cloneEdit(e: PhotoEdit): PhotoEdit {
  return JSON.parse(JSON.stringify(e)) as PhotoEdit
}

/** Fill missing fields (older saved edits) with neutral values. */
export function normalizeEdit(e: Partial<PhotoEdit> | null | undefined): PhotoEdit {
  const n = cloneEdit(NEUTRAL)
  if (!e) return n
  return {
    version: 1,
    light: { ...n.light, ...e.light },
    color: { ...n.color, ...e.color },
    detail: { ...n.detail, ...e.detail },
    effects: { ...n.effects, ...e.effects },
    geometry: { ...n.geometry, ...e.geometry },
    filter: e.filter ?? null
  }
}

export function isNeutral(e: PhotoEdit): boolean {
  return JSON.stringify({ ...normalizeEdit(e), filter: null }) === JSON.stringify({ ...NEUTRAL, filter: null })
}

export interface FilterPreset {
  id: string
  name: string
  apply(e: PhotoEdit): PhotoEdit
}

const withValues = (e: PhotoEdit, patch: { light?: Partial<PhotoEdit['light']>; color?: Partial<PhotoEdit['color']>; detail?: Partial<PhotoEdit['detail']>; effects?: Partial<PhotoEdit['effects']> }, id: string): PhotoEdit => ({
  ...e,
  light: { ...NEUTRAL.light, ...patch.light, exposure: e.light.exposure },
  color: { ...NEUTRAL.color, ...patch.color },
  detail: { ...e.detail, ...patch.detail },
  effects: { ...NEUTRAL.effects, ...patch.effects },
  filter: id
})

export const FILTERS: FilterPreset[] = [
  { id: 'none', get name() { return t('Original') }, apply: (e) => ({ ...withValues(e, {}, 'none'), light: { ...NEUTRAL.light, exposure: e.light.exposure }, filter: null }) },
  { id: 'vivid', get name() { return t('Éclatant') }, apply: (e) => withValues(e, { light: { contrast: 18, shadows: 12 }, color: { vibrance: 35, saturation: 8 } }, 'vivid') },
  { id: 'warm', get name() { return t('Chaleureux') }, apply: (e) => withValues(e, { light: { contrast: 10 }, color: { temperature: 28, vibrance: 15 } }, 'warm') },
  { id: 'cool', get name() { return t('Frais') }, apply: (e) => withValues(e, { light: { contrast: 10 }, color: { temperature: -25, vibrance: 10 } }, 'cool') },
  { id: 'dramatic', get name() { return t('Dramatique') }, apply: (e) => withValues(e, { light: { contrast: 35, highlights: -40, shadows: 20, blacks: -15 }, color: { saturation: -12 }, detail: { clarity: 35 }, effects: { vignette: -25 } }, 'dramatic') },
  { id: 'soft', get name() { return t('Douceur') }, apply: (e) => withValues(e, { light: { contrast: -18, highlights: -15, shadows: 15 }, color: { vibrance: 10 }, effects: { fade: 18 } }, 'soft') },
  { id: 'film', get name() { return t('Argentique') }, apply: (e) => withValues(e, { light: { contrast: 12, blacks: 8 }, color: { temperature: 10, saturation: -15 }, effects: { fade: 22, grain: 25, vignette: -12 } }, 'film') },
  { id: 'mono', get name() { return t('Noir et blanc') }, apply: (e) => withValues(e, { light: { contrast: 15 }, color: { mono: true } }, 'mono') },
  { id: 'mono-hc', get name() { return t('N&B contrasté') }, apply: (e) => withValues(e, { light: { contrast: 45, blacks: -20, whites: 15 }, color: { mono: true }, detail: { clarity: 25 }, effects: { grain: 15, vignette: -20 } }, 'mono-hc') }
]
