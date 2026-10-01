# ffmpeg

`node scripts/fetch-ffmpeg.mjs` downloads static ffmpeg and ffprobe builds here (not committed):

- `darwin-arm64/`: Martin Riedl's macOS builds, https://ffmpeg.martin-riedl.de
- `win32-x64/`: BtbN's Windows builds, https://github.com/BtbN/FFmpeg-Builds

Both are FFmpeg (https://ffmpeg.org) compiled under the GNU GPL v3. MyPhotos runs them as separate programs.
Sources: https://ffmpeg.org/download.html and the build recipes in the two repositories above.
