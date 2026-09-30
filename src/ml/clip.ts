/**
 * CLIP ViT-B/32 (Xenova ONNX export) through transformers.js for image/text embeddings,
 * semantic search and zero-shot categories. Models are read from a local folder only.
 */
import { env, AutoProcessor, AutoTokenizer, CLIPTextModelWithProjection, CLIPVisionModelWithProjection, RawImage } from '@huggingface/transformers'

export const CLIP_DIM = 512

export class ClipEngine {
  private vision: CLIPVisionModelWithProjection | null = null
  private text: CLIPTextModelWithProjection | null = null
  private processor: Awaited<ReturnType<typeof AutoProcessor.from_pretrained>> | null = null
  private tokenizer: Awaited<ReturnType<typeof AutoTokenizer.from_pretrained>> | null = null

  /** @param modelsDir folder containing `clip/` (config, tokenizer, onnx/*_quantized.onnx) */
  constructor(private modelsDir: string) {}

  async load(): Promise<void> {
    if (this.vision) return
    env.allowRemoteModels = false
    env.allowLocalModels = true
    env.localModelPath = this.modelsDir
    env.useFSCache = false
    const opts = { dtype: 'q8' as const, device: 'cpu' as const }
    this.processor = await AutoProcessor.from_pretrained('clip')
    this.tokenizer = await AutoTokenizer.from_pretrained('clip')
    this.vision = await CLIPVisionModelWithProjection.from_pretrained('clip', opts)
    this.text = await CLIPTextModelWithProjection.from_pretrained('clip', opts)
  }

  private static normalize(v: Float32Array): Float32Array {
    let n = 0
    for (const x of v) n += x * x
    n = Math.sqrt(n) || 1
    const out = new Float32Array(v.length)
    for (let i = 0; i < v.length; i++) out[i] = v[i]! / n
    return out
  }

  async embedImage(file: string): Promise<Float32Array> {
    return this.embedRaw(await RawImage.read(file))
  }

  async embedRaw(image: RawImage): Promise<Float32Array> {
    await this.load()
    const inputs = await this.processor!(image)
    const { image_embeds } = await this.vision!(inputs)
    return ClipEngine.normalize(image_embeds.data as Float32Array)
  }

  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    await this.load()
    const inputs = this.tokenizer!(texts, { padding: true, truncation: true })
    const { text_embeds } = await this.text!(inputs)
    const data = text_embeds.data as Float32Array
    const out: Float32Array[] = []
    for (let i = 0; i < texts.length; i++) out.push(ClipEngine.normalize(data.slice(i * CLIP_DIM, (i + 1) * CLIP_DIM)))
    return out
  }

  async dispose(): Promise<void> {
    await this.vision?.dispose()
    await this.text?.dispose()
    this.vision = this.text = null
  }
}
