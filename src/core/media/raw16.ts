/**
 * Full RAW development (LibRaw compiled to WebAssembly) for work that needs the sensor's range, such as HDR fusion.
 * Thumbnails and viewing keep using the embedded JPEG preview, which is much faster.
 */
import { readFile } from 'node:fs/promises'
import { createRequire } from 'node:module'

interface LibRawImage {
  width: number
  height: number
  colors: number
  bits: number
  data: Uint16Array
}

interface LibRawInstance {
  open(file: Uint8Array, settings: Record<string, unknown>): void
  imageData(): LibRawImage
  /** frees the instance's WebAssembly memory (Embind) */
  delete(): void
}

interface LibRawModule {
  LibRaw: new () => LibRawInstance
}

let loading: Promise<LibRawModule> | null = null

/** The package targets browsers and cannot fetch its own .wasm under Node: hand it the bytes. */
function libraw(): Promise<LibRawModule> {
  return (loading ??= (async () => {
    const require = createRequire(import.meta.url)
    const wasmBinary = await readFile(require.resolve('libraw-wasm/dist/libraw.wasm'))
    const { default: factory } = (await import('libraw-wasm/dist/libraw.js')) as { default: (opts: { wasmBinary: Uint8Array }) => Promise<LibRawModule> }
    return factory({ wasmBinary })
  })())
}

export interface Raw16 {
  width: number
  height: number
  /** interleaved RGB, 16 bits per sample */
  data: Uint16Array
}

/**
 * Develop a RAW file to 16-bit sRGB with the camera's white balance and no auto-brightening, so frames of an exposure
 * series keep their relative brightness. The camera's orientation is applied.
 */
export async function decodeRaw16(path: string): Promise<Raw16> {
  const { LibRaw } = await libraw()
  const file = new Uint8Array(await readFile(path))
  const lr = new LibRaw()
  try {
    lr.open(file, { outputBps: 16, outputColor: 1, useCameraWb: true, noAutoBright: true, userQual: 3 })
    const img = lr.imageData()
    if (!img || img.colors !== 3 || img.bits !== 16) throw new Error(`RAW development failed (${path})`)
    // copied out before the instance (and the memory the pixels may live in) is freed
    return { width: img.width, height: img.height, data: img.data.slice() }
  } catch (e) {
    // the WebAssembly side throws plain numbers: give the person a readable reason
    throw e instanceof Error ? e : new Error(`RAW development failed (${path})`)
  } finally {
    lr.delete()
  }
}
