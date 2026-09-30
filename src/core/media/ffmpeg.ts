import { spawn } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

let resolved: { ffmpeg: string; ffprobe: string } | null = null

/**
 * Locate ffmpeg/ffprobe: explicit env, then bundled resources/ffmpeg/<platform>-<arch>, then PATH.
 * HEIC grids from iPhones need ffmpeg >= 8.1.
 */
export function ffmpegPaths(): { ffmpeg: string; ffprobe: string } {
  if (resolved) return resolved
  const exe = process.platform === 'win32' ? '.exe' : ''
  const candidates: string[] = []
  if (process.env.MYPHOTOS_FFMPEG_DIR) candidates.push(process.env.MYPHOTOS_FFMPEG_DIR)
  const resDir = process.env.MYPHOTOS_RESOURCES
  if (resDir) candidates.push(join(resDir, 'ffmpeg', `${process.platform}-${process.arch}`))
  candidates.push(join(process.cwd(), 'resources', 'ffmpeg', `${process.platform}-${process.arch}`))
  if (process.platform === 'darwin') candidates.push('/opt/homebrew/bin', '/usr/local/bin')
  for (const dir of candidates) {
    const ffmpeg = join(dir, `ffmpeg${exe}`)
    const ffprobe = join(dir, `ffprobe${exe}`)
    if (existsSync(ffmpeg) && existsSync(ffprobe)) return (resolved = { ffmpeg, ffprobe })
  }
  return (resolved = { ffmpeg: `ffmpeg${exe}`, ffprobe: `ffprobe${exe}` })
}

export interface RunResult {
  stdout: Buffer
  stderr: string
}

export function run(bin: string, args: string[], opts: { timeoutMs?: number; signal?: AbortSignal } = {}): Promise<RunResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(bin, args, { stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true, signal: opts.signal })
    const out: Buffer[] = []
    let err = ''
    const timer = opts.timeoutMs ? setTimeout(() => child.kill('SIGKILL'), opts.timeoutMs) : null
    child.stdout.on('data', (d: Buffer) => out.push(d))
    child.stderr.on('data', (d: Buffer) => {
      if (err.length < 8000) err += d.toString()
    })
    child.on('error', (e) => {
      if (timer) clearTimeout(timer)
      reject(e)
    })
    child.on('close', (code) => {
      if (timer) clearTimeout(timer)
      if (code === 0) resolve({ stdout: Buffer.concat(out), stderr: err })
      else reject(new Error(`${bin} exited with ${code}: ${err.slice(-1000)}`))
    })
  })
}

export async function ffprobe(file: string): Promise<FfprobeResult> {
  const { stdout } = await run(ffmpegPaths().ffprobe, ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file], { timeoutMs: 30000 })
  return JSON.parse(stdout.toString()) as FfprobeResult
}

export interface FfprobeStream {
  codec_type?: string
  codec_name?: string
  width?: number
  height?: number
  duration?: string
  tags?: Record<string, string>
  side_data_list?: Array<{ side_data_type?: string; rotation?: number }>
}

export interface FfprobeResult {
  streams?: FfprobeStream[]
  format?: { duration?: string; tags?: Record<string, string>; format_name?: string }
}

/** Decode one frame of any ffmpeg-readable input to a high quality JPEG buffer. */
export async function decodeFrame(file: string, opts: { seek?: number } = {}): Promise<Buffer> {
  const args = ['-v', 'error']
  if (opts.seek && opts.seek > 0) args.push('-ss', opts.seek.toFixed(2))
  args.push('-i', file, '-frames:v', '1', '-f', 'image2pipe', '-c:v', 'mjpeg', '-q:v', '2', '-')
  const { stdout } = await run(ffmpegPaths().ffmpeg, args, { timeoutMs: 60000 })
  if (stdout.length === 0) throw new Error(`ffmpeg produced no frame for ${file}`)
  return stdout
}
