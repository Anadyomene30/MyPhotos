#!/bin/sh
# Windows x64 installer built on a Mac (for testing; the release build can also run on Windows with `npm run build:win`).
# sharp's Windows binaries are added to node_modules for the build only. The installer is not code-signed.
set -e
cd "$(dirname "$0")/.."
OUT="${MYPHOTOS_BUILD_DIR:-$HOME/Library/Caches/MyPhotos-build-win}"
SHARP=$(node -p "require('./node_modules/sharp/package.json').version")
PKG=node_modules/@img/sharp-win32-x64
cleanup() { rm -rf "$PKG"; }
trap cleanup EXIT
node scripts/fetch-ffmpeg.mjs win32-x64
TMP=$(mktemp -d)
(cd "$TMP" && npm pack --silent "@img/sharp-win32-x64@$SHARP" >/dev/null && tar -xzf ./*.tgz)
rm -rf "$PKG" && mkdir -p "$PKG" && cp -R "$TMP/package/." "$PKG/" && rm -rf "$TMP"
rm -rf "$OUT"
npx electron-vite build
npx electron-builder --win "$@" -c.directories.output="$OUT"
mkdir -p dist
for f in "$OUT"/*.exe; do [ -e "$f" ] && cp "$f" dist/; done
echo "Build: $OUT"
