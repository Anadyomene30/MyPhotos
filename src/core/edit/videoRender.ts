import { spawn } from 'node:child_process'
import { ffmpegPaths } from '../media/ffmpeg'
import { availableEncoders } from '../export/video'
import type { VideoEdit } from '@shared/edit/video'

let filterCache: Set<string> | null = null
async function availableFilters(): Promise<Set<string>> {
  if (filterCache) return filterCache
  const out = await new Promise<string>((resolve) => {
    const p = spawn(ffmpegPaths().ffmpeg, ['-hide_banner', '-filters'], { windowsHide: true })
    let s = ''
    p.stdout.on('data', (d: Buffer) => (s += d.toString()))
    p.on('close', () => resolve(s))
    p.on('error', () => resolve(''))
  })
  filterCache = new Set(out.split('\n').map((l) => /^\s\S{3}\s+(\S+)/.exec(l)?.[1]).filter((x): x is string => Boolean(x)))
  return filterCache
}

function atempoChain(speed: number): string[] {
  const out: string[] = []
  let s = speed
  while (s > 2) {
    out.push('atempo=2')
    s /= 2
  }
  while (s < 0.5) {
    out.push('atempo=0.5')
    s /= 0.5
  }
  out.push(`atempo=${s.toFixed(4)}`)
  return out
}

/** Video filter chain for an edit (without stabilization transforms, added by the caller). */
export function videoFilters(e: VideoEdit, filters: Set<string>): string[] {
  const vf: string[] = []
  if (e.rotate === 1) vf.push('transpose=1')
  if (e.rotate === 2) vf.push('transpose=1,transpose=1')
  if (e.rotate === 3) vf.push('transpose=2')
  if (e.flipH) vf.push('hflip')
  if (e.crop) {
    const c = e.crop
    vf.push(`crop=trunc(iw*${c.w.toFixed(4)}/2)*2:trunc(ih*${c.h.toFixed(4)}/2)*2:iw*${c.x.toFixed(4)}:ih*${c.y.toFixed(4)}`)
  }
  const c = e.color
  if (c.exposure && filters.has('exposure')) vf.push(`exposure=exposure=${c.exposure.toFixed(2)}`)
  if (c.temperature && filters.has('colortemperature')) vf.push(`colortemperature=temperature=${Math.round(6500 - c.temperature * 30)}`)
  if (c.contrast || c.saturation || c.mono) vf.push(`eq=contrast=${(1 + c.contrast / 100).toFixed(3)}:saturation=${c.mono ? 0 : (1 + c.saturation / 100).toFixed(3)}`)
  if (c.vibrance && !c.mono && filters.has('vibrance')) vf.push(`vibrance=intensity=${(c.vibrance / 100).toFixed(2)}`)
  if (e.detail.denoise) vf.push(`hqdn3d=${(e.detail.denoise / 25).toFixed(2)}:${(e.detail.denoise / 33).toFixed(2)}:${(e.detail.denoise / 16).toFixed(2)}:${(e.detail.denoise / 16).toFixed(2)}`)
  if (e.detail.sharpness) vf.push(`unsharp=5:5:${(e.detail.sharpness / 60).toFixed(2)}:5:5:0`)
  if (e.speed !== 1) vf.push(`setpts=PTS/${e.speed.toFixed(4)}`)
  if (e.output.maxHeight) vf.push(`scale=-2:'min(ih,${e.output.maxHeight})':flags=lanczos`)
  vf.push('format=yuv420p')
  return vf
}

export interface VideoRenderPlan {
  passes: string[][]
}

export async function planVideoEdit(input: string, output: string, e: VideoEdit, tmpTrf: string, creationIso: string | null): Promise<VideoRenderPlan> {
  const filters = await availableFilters()
  const encoders = await availableEncoders()
  const seek = e.trim.start > 0 ? ['-ss', e.trim.start.toFixed(3)] : []
  const to = e.trim.end ? ['-to', e.trim.end.toFixed(3)] : []
  const vf = videoFilters(e, filters)
  const passes: string[][] = []
  const vidstab = e.stabilize && filters.has('vidstabdetect') && filters.has('vidstabtransform')
  if (vidstab) {
    passes.push(['-hide_banner', '-v', 'error', '-y', ...seek, ...to, '-i', input, '-vf', `vidstabdetect=shakiness=6:accuracy=12:result='${tmpTrf.replace(/'/g, "\\'")}'`, '-f', 'null', '-'])
    vf.unshift(`vidstabtransform=input='${tmpTrf.replace(/'/g, "\\'")}':smoothing=18:zoom=3`)
  } else if (e.stabilize) vf.unshift('deshake')
  const hevc = e.output.format === 'mp4-hevc'
  const hw = hevc ? ['hevc_videotoolbox', 'hevc_nvenc', 'hevc_qsv'].find((x) => encoders.has(x)) : ['h264_videotoolbox', 'h264_nvenc', 'h264_qsv'].find((x) => encoders.has(x))
  const sw = hevc ? 'libx265' : 'libx264'
  const crf = hevc ? { high: 20, medium: 25, small: 29 }[e.output.quality] : { high: 17, medium: 21, small: 26 }[e.output.quality]
  // quality matters more than speed for edits: prefer software when available
  const venc = encoders.has(sw) ? ['-c:v', sw, '-preset', 'medium', '-crf', String(crf)] : hw ? ['-c:v', hw, '-b:v', e.output.quality === 'high' ? '16M' : e.output.quality === 'medium' ? '8M' : '4M'] : ['-c:v', 'mpeg4', '-q:v', '3']
  const af: string[] = []
  if (!e.audio.mute) {
    if (e.speed !== 1) af.push(...atempoChain(e.speed))
    if (e.audio.volume !== 1) af.push(`volume=${e.audio.volume.toFixed(2)}`)
  }
  passes.push([
    '-hide_banner', '-v', 'error', '-y', ...seek, ...to, '-i', input, '-progress', 'pipe:1', '-nostats',
    '-map', '0:v:0', ...(e.audio.mute ? ['-an'] : ['-map', '0:a:0?']),
    '-map_metadata', '0', ...(creationIso ? ['-metadata', `creation_time=${creationIso}`] : []),
    '-vf', vf.join(','), ...venc, ...(hevc ? ['-tag:v', 'hvc1'] : []),
    ...(e.audio.mute ? [] : ['-c:a', 'aac', '-b:a', '192k', ...(af.length ? ['-af', af.join(',')] : [])]),
    '-movflags', '+faststart', output
  ])
  return { passes }
}
