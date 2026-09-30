/** Video edits are rendered into a new file (the original is never modified). */
export interface VideoEdit {
  trim: { start: number; end: number | null }
  speed: number
  rotate: 0 | 1 | 2 | 3
  flipH: boolean
  crop: { x: number; y: number; w: number; h: number } | null
  color: { exposure: number; contrast: number; saturation: number; temperature: number; vibrance: number; mono: boolean }
  detail: { sharpness: number; denoise: number }
  stabilize: boolean
  audio: { volume: number; mute: boolean }
  output: { format: 'mp4-h264' | 'mp4-hevc'; quality: 'high' | 'medium' | 'small'; maxHeight: number | null }
}

export const NEUTRAL_VIDEO: VideoEdit = {
  trim: { start: 0, end: null },
  speed: 1,
  rotate: 0,
  flipH: false,
  crop: null,
  color: { exposure: 0, contrast: 0, saturation: 0, temperature: 0, vibrance: 0, mono: false },
  detail: { sharpness: 0, denoise: 0 },
  stabilize: false,
  audio: { volume: 1, mute: false },
  output: { format: 'mp4-h264', quality: 'high', maxHeight: null }
}

/** CSS filter approximating the color settings for the live preview. */
export function cssPreviewFilter(e: VideoEdit): string {
  const c = e.color
  const parts = [
    `brightness(${Math.pow(2, c.exposure * 0.8).toFixed(3)})`,
    `contrast(${(1 + c.contrast / 100).toFixed(3)})`,
    `saturate(${Math.max(0, 1 + c.saturation / 100 + c.vibrance / 200).toFixed(3)})`
  ]
  if (c.temperature > 0) parts.push(`sepia(${(c.temperature / 100) * 0.35})`)
  if (c.temperature < 0) parts.push(`hue-rotate(${(c.temperature / 100) * 12}deg)`)
  if (c.mono) parts.push('grayscale(1)')
  return parts.join(' ')
}
