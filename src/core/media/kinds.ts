import type { AssetKind } from '@shared/types'

export const RAW_EXTS = new Set(['cr2', 'cr3', 'crw', 'nef', 'nrw', 'arw', 'srf', 'sr2', 'dng', 'raf', 'orf', 'rw2', 'pef', 'srw', '3fr', 'iiq', 'erf', 'kdc', 'mrw', 'x3f'])
/** Formats sharp decodes natively with its prebuilt libvips. */
export const SHARP_EXTS = new Set(['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'tif', 'tiff', 'avif'])
export const HEIF_EXTS = new Set(['heic', 'heif', 'hif'])
export const OTHER_PHOTO_EXTS = new Set(['bmp', 'jxl'])
export const VIDEO_EXTS = new Set(['mov', 'mp4', 'm4v', 'avi', 'mkv', 'webm', '3gp', '3g2', 'mts', 'm2ts', 'mpg', 'mpeg', 'wmv', 'flv'])
/** Formats Chromium can display without transcoding. */
export const WEB_NATIVE_IMAGE_EXTS = new Set(['jpg', 'jpeg', 'jpe', 'png', 'webp', 'gif', 'avif'])
export const WEB_NATIVE_VIDEO_EXTS = new Set(['mp4', 'm4v', 'mov', 'webm'])

export function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i < 0 ? '' : name.slice(i + 1).toLowerCase()
}

export function stemOf(name: string): string {
  const i = name.lastIndexOf('.')
  return (i < 0 ? name : name.slice(0, i)).toLowerCase()
}

export function kindOf(ext: string): AssetKind | null {
  if (VIDEO_EXTS.has(ext)) return 'video'
  if (SHARP_EXTS.has(ext) || HEIF_EXTS.has(ext) || RAW_EXTS.has(ext) || OTHER_PHOTO_EXTS.has(ext)) return 'photo'
  return null
}

export function isWebNative(kind: AssetKind, ext: string): boolean {
  return kind === 'photo' ? WEB_NATIVE_IMAGE_EXTS.has(ext) : WEB_NATIVE_VIDEO_EXTS.has(ext)
}

const SCREENSHOT_NAME = /(screen ?shot|capture d.[ée]cran|capture_d_ecran|bildschirmfoto|captura de pantalla|schermafbeelding|スクリーンショット)/i

export function looksLikeScreenshot(name: string, ext: string, hasCamera: boolean, userComment?: string | null): boolean {
  if (userComment && /screenshot/i.test(userComment)) return true
  if (SCREENSHOT_NAME.test(name)) return true
  return ext === 'png' && !hasCamera && /^(IMG_\d+|Screenshot)/i.test(name)
}
