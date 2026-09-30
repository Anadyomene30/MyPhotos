#!/bin/sh
# Headless backend on the real app library (same data folder as the desktop app), port 47800.
cd "$(dirname "$0")/.." || exit 1
MYPHOTOS_DATA="$HOME/Library/Application Support/MyPhotos/library" \
MYPHOTOS_CREATIONS="$HOME/Pictures/MyPhotos Créations" \
MYPHOTOS_TOKEN=dev MYPHOTOS_PORT=47800 \
exec node .devdata/real-build/main/backend.js
