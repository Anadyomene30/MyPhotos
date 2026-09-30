import { run, ffmpegPaths } from '../media/ffmpeg'
import type { ExportOptions, VideoFormat } from '@shared/types'

let encoderCache: Set<string> | null = null

export async function availableEncoders(): Promise<Set<string>> {
  if (encoderCache) return encoderCache
  try {
    const { stdout } = await run(ffmpegPaths().ffmpeg, ['-hide_banner', '-encoders'], { timeoutMs: 10000 })
    encoderCache = new Set(
      stdout
        .toString()
        .split('\n')
        .map((l) => /^\s[VAS][A-Z.]{5}\s+(\S+)/.exec(l)?.[1])
        .filter((x): x is string => Boolean(x))
    )
  } catch {
    encoderCache = new Set()
  }
  return encoderCache
}

export const VIDEO_EXT: Record<Exclude<VideoFormat, 'original'>, string> = {
  'mp4-h264': 'mp4', 'mp4-hevc': 'mp4', webm: 'webm', 'mov-prores': 'mov', gif: 'gif'
}

const HW: Record<'h264' | 'hevc', string[]> = {
  h264: ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv', 'h264_amf'],
  hevc: ['hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv', 'hevc_amf']
}

/** Target bitrate in Mbit/s for hardware encoders (they lack a reliable constant-quality mode everywhere). */
function bitrate(height: number, quality: ExportOptions['video']['quality'], hevc: boolean): number {
  const base = height >= 2000 ? 40 : height >= 1400 ? 20 : height >= 1000 ? 10 : height >= 700 ? 5 : 2.5
  const q = quality === 'high' ? 1.4 : quality === 'medium' ? 0.8 : 0.45
  return Math.max(0.8, base * q * (hevc ? 0.6 : 1))
}

export interface VideoPlan {
  args: string[]
  ext: string
  /** software fallback if the hardware encoder fails at runtime */
  fallback: string[] | null
}

/**
 * Build ffmpeg arguments for a conversion. `outHeight` is the expected displayed height after scaling.
 */
export function planVideo(
  input: string,
  output: string,
  opts: Pick<ExportOptions, 'video' | 'metadata'>,
  encoders: Set<string>,
  srcHeight: number | null,
  creationIso: string | null
): VideoPlan {
  const f = opts.video.format as Exclude<VideoFormat, 'original'>
  const q = opts.video.quality
  const maxH = opts.video.maxHeight
  const outH = Math.min(srcHeight ?? 1080, maxH ?? Infinity)
  const scale = maxH && (srcHeight === null || srcHeight > maxH) ? `scale=-2:${maxH}:flags=lanczos` : null
  const head = ['-hide_banner', '-v', 'error', '-y', '-i', input, '-progress', 'pipe:1', '-nostats']
  const meta: string[] = []
  if (opts.metadata === 'all') meta.push('-map_metadata', '0')
  else {
    meta.push('-map_metadata', '-1')
    if (creationIso && opts.metadata === 'noLocation') meta.push('-metadata', `creation_time=${creationIso}`)
  }

  if (f === 'gif') {
    const vf = `fps=12,scale=${Math.min(maxH ?? 480, 480)}:-2:flags=lanczos,split[a][b];[a]palettegen=stats_mode=diff[p];[b][p]paletteuse=dither=bayer:bayer_scale=4`
    return { args: [...head, '-filter_complex', vf, '-an', '-loop', '0', output], ext: 'gif', fallback: null }
  }

  const vf = ['format=yuv420p']
  if (scale) vf.unshift(scale)
  const common = [...meta, '-map', '0:v:0', '-map', '0:a:0?']

  if (f === 'webm') {
    const crf = q === 'high' ? 28 : q === 'medium' ? 33 : 38
    return {
      args: [...head, ...common, '-vf', vf.join(','), '-c:v', 'libvpx-vp9', '-crf', String(crf), '-b:v', '0', '-row-mt', '1', '-deadline', 'good', '-cpu-used', '4', '-c:a', 'libopus', '-b:a', '128k', output],
      ext: 'webm',
      fallback: null
    }
  }

  if (f === 'mov-prores') {
    const hw = encoders.has('prores_videotoolbox')
    const profile = q === 'high' ? '3' : q === 'medium' ? '2' : '0'
    const sw = [...head, ...common, ...(scale ? ['-vf', scale] : []), '-c:v', 'prores_ks', '-profile:v', profile, '-pix_fmt', 'yuv422p10le', '-c:a', 'pcm_s16le', output]
    const hwArgs = [...head, ...common, ...(scale ? ['-vf', scale] : []), '-c:v', 'prores_videotoolbox', '-profile:v', profile, '-c:a', 'pcm_s16le', output]
    return { args: hw ? hwArgs : sw, ext: 'mov', fallback: hw ? sw : null }
  }

  const codec = f === 'mp4-hevc' ? 'hevc' : 'h264'
  const hwEnc = HW[codec].find((e) => encoders.has(e))
  const tag = codec === 'hevc' ? ['-tag:v', 'hvc1'] : []
  const audio = ['-c:a', 'aac', '-b:a', q === 'small' ? '128k' : '192k']
  const tail = ['-movflags', '+faststart', output]
  const crf = codec === 'hevc' ? (q === 'high' ? 20 : q === 'medium' ? 25 : 30) : q === 'high' ? 18 : q === 'medium' ? 22 : 27
  const swEnc = codec === 'hevc' ? 'libx265' : 'libx264'
  const sw = [...head, ...common, '-vf', vf.join(','), '-c:v', swEnc, '-preset', 'medium', '-crf', String(crf), ...tag, ...audio, ...tail]
  if (!hwEnc) return { args: sw, ext: 'mp4', fallback: null }
  const mbps = bitrate(outH, q, codec === 'hevc')
  const hw = [...head, ...common, '-vf', vf.join(','), '-c:v', hwEnc, '-b:v', `${mbps.toFixed(1)}M`, '-maxrate', `${(mbps * 1.5).toFixed(1)}M`, '-bufsize', `${(mbps * 2).toFixed(1)}M`, ...tag, ...audio, ...tail]
  return { args: hw, ext: 'mp4', fallback: encoders.has(swEnc) ? sw : null }
}
