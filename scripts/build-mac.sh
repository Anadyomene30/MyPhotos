#!/bin/sh
# macOS build. Signing fails inside iCloud-synced folders (Documents, Desktop): File Provider adds Finder attributes
# that codesign rejects. Build in a local cache, then copy the DMG files into dist/.
# Usage: scripts/build-mac.sh [--dir] [--arm64|--x64]
set -e
cd "$(dirname "$0")/.."
OUT="${MYPHOTOS_BUILD_DIR:-$HOME/Library/Caches/MyPhotos-build}"
rm -rf "$OUT"
node scripts/fetch-ffmpeg.mjs darwin-arm64
npx electron-vite build
npx electron-builder --mac "$@" -c.directories.output="$OUT"
mkdir -p dist
for f in "$OUT"/*.dmg; do [ -e "$f" ] && cp "$f" dist/; done
echo "Build: $OUT"
