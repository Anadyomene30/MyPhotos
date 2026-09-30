/**
 * Face detection (SCRFD 10G, buffalo_l) and recognition (ArcFace ResNet50, w600k_r50) with onnxruntime-node.
 * Pre/post-processing mirrors the InsightFace Python reference implementation.
 */
import * as ort from 'onnxruntime-node'
import sharp from 'sharp'

export interface DetectedFace {
  /** box in pixels of the analyzed image */
  x1: number
  y1: number
  x2: number
  y2: number
  score: number
  /** five landmarks: left eye, right eye, nose, left mouth, right mouth */
  kps: Array<[number, number]>
}

export interface FaceResult extends DetectedFace {
  embedding: Float32Array
  /** 0..1 quality from box size and detection confidence */
  quality: number
}

const DET_SIZE = 640
const STRIDES = [8, 16, 32]
const NUM_ANCHORS = 2
const DET_THRESHOLD = 0.55
const NMS_THRESHOLD = 0.4

/** ArcFace reference landmarks for a 112×112 crop. */
export const ARCFACE_DST: Array<[number, number]> = [
  [38.2946, 51.6963],
  [73.5318, 51.5014],
  [41.5493, 92.3655],
  [70.7299, 92.2041],
  [56.1396, 92.2848]
]

function sessionOptions(): ort.InferenceSession.SessionOptions {
  const providers: ort.InferenceSession.ExecutionProviderConfig[] = []
  if (process.platform === 'darwin') providers.push({ name: 'coreml', useCPUOnly: false } as never)
  if (process.platform === 'win32') providers.push('dml' as never)
  providers.push('cpu')
  return { executionProviders: providers, graphOptimizationLevel: 'all', logSeverityLevel: 3 }
}

async function createSession(file: string): Promise<ort.InferenceSession> {
  try {
    return await ort.InferenceSession.create(file, sessionOptions())
  } catch {
    return ort.InferenceSession.create(file, { executionProviders: ['cpu'], graphOptimizationLevel: 'all', logSeverityLevel: 3 })
  }
}

function nms(faces: DetectedFace[], thr: number): DetectedFace[] {
  const sorted = [...faces].sort((a, b) => b.score - a.score)
  const keep: DetectedFace[] = []
  for (const f of sorted) {
    let ok = true
    for (const k of keep) {
      const ix = Math.max(0, Math.min(f.x2, k.x2) - Math.max(f.x1, k.x1))
      const iy = Math.max(0, Math.min(f.y2, k.y2) - Math.max(f.y1, k.y1))
      const inter = ix * iy
      const union = (f.x2 - f.x1) * (f.y2 - f.y1) + (k.x2 - k.x1) * (k.y2 - k.y1) - inter
      if (union > 0 && inter / union > thr) {
        ok = false
        break
      }
    }
    if (ok) keep.push(f)
  }
  return keep
}

/**
 * Similarity transform (Umeyama, no reflection) mapping src points onto dst points.
 * Returns [a, b, tx, c, d, ty] for x' = a x + b y + tx, y' = c x + d y + ty.
 */
export function similarityTransform(src: Array<[number, number]>, dst: Array<[number, number]>): [number, number, number, number, number, number] {
  const n = src.length
  let mx = 0, my = 0, dx = 0, dy = 0
  for (let i = 0; i < n; i++) {
    mx += src[i]![0]; my += src[i]![1]; dx += dst[i]![0]; dy += dst[i]![1]
  }
  mx /= n; my /= n; dx /= n; dy /= n
  let sxx = 0, sxy = 0, syx = 0, syy = 0, varSrc = 0
  for (let i = 0; i < n; i++) {
    const ax = src[i]![0] - mx, ay = src[i]![1] - my
    const bx = dst[i]![0] - dx, by = dst[i]![1] - dy
    sxx += bx * ax; sxy += bx * ay; syx += by * ax; syy += by * ay
    varSrc += ax * ax + ay * ay
  }
  sxx /= n; sxy /= n; syx /= n; syy /= n; varSrc /= n
  // 2×2 SVD of the cross-covariance via rotation angle: R = U V^T maximizes trace(R^T Σ)
  const theta = Math.atan2(syx - sxy, sxx + syy)
  const cos = Math.cos(theta), sin = Math.sin(theta)
  const traceRS = cos * (sxx + syy) + sin * (syx - sxy)
  const scale = varSrc > 0 ? traceRS / varSrc : 1
  const a = scale * cos, b = -scale * sin, c = scale * sin, d = scale * cos
  return [a, b, dx - (a * mx + b * my), c, d, dy - (c * mx + d * my)]
}

/** Warp an RGB image with the inverse of a similarity transform into a size×size crop (bilinear). */
export function warpCrop(rgb: Uint8Array, w: number, h: number, t: [number, number, number, number, number, number], size: number): Uint8Array {
  const [a, b, tx, c, d, ty] = t
  const det = a * d - b * c || 1e-9
  const ia = d / det, ib = -b / det, ic = -c / det, id = a / det
  const out = new Uint8Array(size * size * 3)
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const ux = x - tx, uy = y - ty
      const sx = ia * ux + ib * uy
      const sy = ic * ux + id * uy
      const x0 = Math.floor(sx), y0 = Math.floor(sy)
      const fx = sx - x0, fy = sy - y0
      const o = (y * size + x) * 3
      if (x0 < 0 || y0 < 0 || x0 >= w - 1 || y0 >= h - 1) continue
      const i00 = (y0 * w + x0) * 3, i01 = i00 + 3, i10 = i00 + w * 3, i11 = i10 + 3
      for (let ch = 0; ch < 3; ch++) {
        out[o + ch] = (rgb[i00 + ch]! * (1 - fx) + rgb[i01 + ch]! * fx) * (1 - fy) + (rgb[i10 + ch]! * (1 - fx) + rgb[i11 + ch]! * fx) * fy
      }
    }
  }
  return out
}

export class FaceEngine {
  private det: ort.InferenceSession | null = null
  private rec: ort.InferenceSession | null = null
  constructor(private detFile: string, private recFile: string) {}

  async load(): Promise<void> {
    this.det ??= await createSession(this.detFile)
    this.rec ??= await createSession(this.recFile)
  }

  /** Detect faces in an RGB buffer (any size); coordinates are returned in that buffer's pixels. */
  async detect(rgb: Uint8Array, w: number, h: number): Promise<DetectedFace[]> {
    await this.load()
    const scale = Math.min(DET_SIZE / w, DET_SIZE / h)
    const nw = Math.round(w * scale), nh = Math.round(h * scale)
    const resized = await sharp(rgb, { raw: { width: w, height: h, channels: 3 } }).resize(nw, nh, { kernel: 'lanczos3' }).raw().toBuffer()
    // letterbox into 640×640, NCHW, (x - 127.5) / 128
    const input = new Float32Array(3 * DET_SIZE * DET_SIZE)
    const plane = DET_SIZE * DET_SIZE
    for (let y = 0; y < nh; y++) {
      for (let x = 0; x < nw; x++) {
        const s = (y * nw + x) * 3
        const d = y * DET_SIZE + x
        input[d] = (resized[s]! - 127.5) / 128
        input[plane + d] = (resized[s + 1]! - 127.5) / 128
        input[2 * plane + d] = (resized[s + 2]! - 127.5) / 128
      }
    }
    // outside the letterbox the value is (0 - 127.5) / 128, matching a black padding
    const pad = -127.5 / 128
    for (let y = 0; y < DET_SIZE; y++) for (let x = 0; x < DET_SIZE; x++) if (x >= nw || y >= nh) {
      const d = y * DET_SIZE + x
      input[d] = pad; input[plane + d] = pad; input[2 * plane + d] = pad
    }
    const inputName = this.det!.inputNames[0]!
    const out = await this.det!.run({ [inputName]: new ort.Tensor('float32', input, [1, 3, DET_SIZE, DET_SIZE]) })
    const names = this.det!.outputNames
    const faces: DetectedFace[] = []
    for (let s = 0; s < STRIDES.length; s++) {
      const stride = STRIDES[s]!
      const scores = out[names[s]!]!.data as Float32Array
      const bboxes = out[names[s + 3]!]!.data as Float32Array
      const kps = out[names[s + 6]!]!.data as Float32Array
      const fh = DET_SIZE / stride, fw = DET_SIZE / stride
      for (let i = 0; i < scores.length; i++) {
        const score = scores[i]!
        if (score < DET_THRESHOLD) continue
        const cell = Math.floor(i / NUM_ANCHORS)
        const cx = (cell % fw) * stride, cy = Math.floor(cell / fw) * stride
        const x1 = (cx - bboxes[i * 4]! * stride) / scale
        const y1 = (cy - bboxes[i * 4 + 1]! * stride) / scale
        const x2 = (cx + bboxes[i * 4 + 2]! * stride) / scale
        const y2 = (cy + bboxes[i * 4 + 3]! * stride) / scale
        const pts: Array<[number, number]> = []
        for (let k = 0; k < 5; k++) pts.push([(cx + kps[i * 10 + k * 2]! * stride) / scale, (cy + kps[i * 10 + k * 2 + 1]! * stride) / scale])
        faces.push({ x1: Math.max(0, x1), y1: Math.max(0, y1), x2: Math.min(w, x2), y2: Math.min(h, y2), score, kps: pts })
      }
      void fh
    }
    return nms(faces, NMS_THRESHOLD)
  }

  /** 512-d L2-normalized ArcFace embedding of an aligned 112×112 RGB crop. */
  async embed(crop112: Uint8Array): Promise<Float32Array> {
    await this.load()
    const n = 112 * 112
    const input = new Float32Array(3 * n)
    for (let i = 0; i < n; i++) {
      input[i] = (crop112[i * 3]! - 127.5) / 127.5
      input[n + i] = (crop112[i * 3 + 1]! - 127.5) / 127.5
      input[2 * n + i] = (crop112[i * 3 + 2]! - 127.5) / 127.5
    }
    const out = await this.rec!.run({ [this.rec!.inputNames[0]!]: new ort.Tensor('float32', input, [1, 3, 112, 112]) })
    const emb = Float32Array.from(out[this.rec!.outputNames[0]!]!.data as Float32Array)
    let norm = 0
    for (const v of emb) norm += v * v
    norm = Math.sqrt(norm) || 1
    for (let i = 0; i < emb.length; i++) emb[i] = emb[i]! / norm
    return emb
  }

  /** Detect, align and embed every face of an image file. */
  async analyze(file: string, maxFaces = 30): Promise<{ faces: FaceResult[]; width: number; height: number }> {
    const { data, info } = await sharp(file, { failOn: 'none' }).rotate().removeAlpha().raw().toBuffer({ resolveWithObject: true })
    const rgb = new Uint8Array(data.buffer, data.byteOffset, data.length)
    const detected = (await this.detect(rgb, info.width, info.height)).slice(0, maxFaces)
    const faces: FaceResult[] = []
    const minSide = Math.min(info.width, info.height)
    for (const f of detected) {
      const t = similarityTransform(f.kps, ARCFACE_DST)
      const crop = warpCrop(rgb, info.width, info.height, t, 112)
      const embedding = await this.embed(crop)
      const size = Math.max(f.x2 - f.x1, f.y2 - f.y1) / minSide
      const quality = Math.min(1, f.score) * Math.min(1, size / 0.12)
      faces.push({ ...f, embedding, quality })
    }
    return { faces, width: info.width, height: info.height }
  }

  async dispose(): Promise<void> {
    await this.det?.release()
    await this.rec?.release()
    this.det = this.rec = null
  }
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let s = 0
  for (let i = 0; i < a.length; i++) s += a[i]! * b[i]!
  return s
}
