import { createReadStream } from 'node:fs'
import { createHash } from 'node:crypto'
import { open } from 'node:fs/promises'
import xxhash from 'xxhash-wasm'

let hasher: Awaited<ReturnType<typeof xxhash>> | null = null
const CHUNK = 64 * 1024

/**
 * Cheap content fingerprint: size + first 64 KiB + last 64 KiB, xxh64.
 * Equal quick hashes are candidates for exact duplicates, confirmed later with a full SHA-256.
 */
export async function quickHash(file: string, size: number): Promise<string> {
  hasher ??= await xxhash()
  const fh = await open(file, 'r')
  try {
    const head = Buffer.alloc(Math.min(CHUNK, size))
    await fh.read(head, 0, head.length, 0)
    const tailLen = size > CHUNK * 2 ? CHUNK : Math.max(0, size - head.length)
    const tail = Buffer.alloc(tailLen)
    if (tailLen) await fh.read(tail, 0, tailLen, size - tailLen)
    const sizeBuf = Buffer.alloc(8)
    sizeBuf.writeBigUInt64LE(BigInt(size))
    return hasher.h64Raw(Buffer.concat([sizeBuf, head, tail])).toString(16).padStart(16, '0')
  } finally {
    await fh.close()
  }
}

/** Full-content SHA-256, streamed. Used to confirm exact duplicates before anything is removed. */
export function fullHash(file: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const h = createHash('sha256')
    createReadStream(file, { highWaterMark: 1024 * 1024 })
      .on('data', (d) => h.update(d))
      .on('error', reject)
      .on('end', () => resolve(h.digest('hex')))
  })
}
