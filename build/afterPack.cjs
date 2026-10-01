// Runs after the app folder is assembled, before signing.
const { execFileSync } = require('node:child_process')
const { existsSync, readdirSync, rmSync } = require('node:fs')
const { join } = require('node:path')

const ARCH = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

exports.default = async function afterPack(context) {
  const platform = context.electronPlatformName // darwin | win32 | linux
  const arch = ARCH[context.arch]
  const resources = platform === 'darwin'
    ? join(context.appOutDir, `${context.packager.appInfo.productFilename}.app`, 'Contents', 'Resources')
    : join(context.appOutDir, 'resources')

  // onnxruntime-node ships every platform; keep only the one being built
  const ortBin = join(resources, 'app.asar.unpacked', 'node_modules', 'onnxruntime-node', 'bin')
  if (existsSync(ortBin)) {
    for (const napi of readdirSync(ortBin)) {
      for (const os of readdirSync(join(ortBin, napi))) {
        const osDir = join(ortBin, napi, os)
        if (os !== platform) {
          rmSync(osDir, { recursive: true, force: true })
          continue
        }
        for (const a of readdirSync(osDir)) if (a !== arch && arch !== 'universal') rmSync(join(osDir, a), { recursive: true, force: true })
      }
    }
  }

  // codesign refuses files carrying extended attributes (Finder info, provenance) picked up during extraction
  if (platform === 'darwin') execFileSync('xattr', ['-cr', context.appOutDir])
}
