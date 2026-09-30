import { createHash } from 'node:crypto'
import { createReadStream, createWriteStream, existsSync } from 'node:fs'
import { mkdir, rename, rm, stat } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'

export interface ModelFile {
  /** path relative to the models folder */
  path: string
  url: string
  sha256: string
  size: number
}

export interface ModelPack {
  id: 'faces' | 'clip'
  title: string
  files: ModelFile[]
}

const HF = 'https://huggingface.co'

/** Models downloaded on first activation. Sizes are used for progress, hashes to verify integrity. */
export const MODEL_PACKS: ModelPack[] = [
  {
    id: 'faces',
    title: 'Reconnaissance de visages',
    files: [
      { path: 'faces/det_10g.onnx', url: `${HF}/immich-app/buffalo_l/resolve/main/detection/model.onnx`, sha256: '5838f7fe053675b1c7a08b633df49e7af5495cee0493c7dcf6697200b85b5b91', size: 16923827 },
      { path: 'faces/w600k_r50.onnx', url: `${HF}/immich-app/buffalo_l/resolve/main/recognition/model.onnx`, sha256: '4c06341c33c2ca1f86781dab0e829f88ad5b64be9fba56e56bc9ebdefc619e43', size: 174383860 }
    ]
  },
  {
    id: 'clip',
    title: 'Recherche par description et catégories',
    files: [
      { path: 'clip/onnx/vision_model_quantized.onnx', url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/onnx/vision_model_quantized.onnx`, sha256: '583fd1110a514667812fee7d684952aaf82a99b959760c8d7dca7e0ab9839299', size: 89117001 },
      { path: 'clip/onnx/text_model_quantized.onnx', url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/onnx/text_model_quantized.onnx`, sha256: '73baab855d406190da9faa498cfedf65f15cf309f4cc7385b7b032e6d08e5c3a', size: 64504507 },
      ...['config.json', 'preprocessor_config.json', 'tokenizer.json', 'tokenizer_config.json', 'special_tokens_map.json', 'vocab.json', 'merges.txt'].map((f) => ({
        path: `clip/${f}`, url: `${HF}/Xenova/clip-vit-base-patch32/resolve/main/${f}`, sha256: '', size: 0
      }))
    ]
  }
]

export function packInstalled(dir: string, pack: ModelPack): boolean {
  return pack.files.every((f) => existsSync(join(dir, f.path)))
}

async function sha256(file: string): Promise<string> {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(file, { highWaterMark: 4 << 20 })) h.update(chunk as Buffer)
  return h.digest('hex')
}

export interface DownloadProgress {
  (doneBytes: number, totalBytes: number, file: string): void
}

/** Download a pack with resume support; each big file is verified by SHA-256 before being moved into place. */
export async function downloadPack(dir: string, pack: ModelPack, onProgress: DownloadProgress, signal: AbortSignal): Promise<void> {
  const total = pack.files.reduce((a, f) => a + f.size, 0)
  let done = 0
  for (const f of pack.files) {
    const target = join(dir, f.path)
    if (existsSync(target)) {
      done += f.size
      onProgress(done, total, f.path)
      continue
    }
    await mkdir(dirname(target), { recursive: true })
    const part = `${target}.part`
    let offset = 0
    try {
      offset = (await stat(part)).size
    } catch {
      offset = 0
    }
    if (f.size && offset >= f.size) offset = 0
    const res = await fetch(f.url, { headers: offset ? { Range: `bytes=${offset}-` } : {}, signal, redirect: 'follow' })
    if (!res.ok || !res.body) throw new Error(`Téléchargement impossible (${res.status}) : ${f.path}`)
    if (res.status !== 206) offset = 0
    let received = offset
    const counter = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, ctrl) {
        received += chunk.length
        onProgress(done + Math.min(received, f.size || received), total || received, f.path)
        ctrl.enqueue(chunk)
      }
    })
    await pipeline(Readable.fromWeb(res.body.pipeThrough(counter) as never), createWriteStream(part, { flags: offset ? 'a' : 'w' }), { signal })
    if (f.sha256) {
      const h = await sha256(part)
      if (h !== f.sha256) {
        await rm(part, { force: true })
        throw new Error(`Fichier corrompu, réessayez : ${f.path}`)
      }
    }
    await rename(part, target)
    done += f.size
    onProgress(done, total, f.path)
  }
}
