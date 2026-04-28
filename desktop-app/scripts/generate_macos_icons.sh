#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SOURCE_ICON_PATH="src/renderer/assets/default-app-icon.png"
DMG_BACKGROUND_SOURCE_PATH="packaging/macos/assets/dmg-background.svg"
GENERATED_ICON_DIR="packaging/macos/generated-icons"
ICONSET_PATH="$GENERATED_ICON_DIR/icon.iconset"

if [[ ! -f "$SOURCE_ICON_PATH" ]]; then
  echo "Missing macOS source icon at $SOURCE_ICON_PATH" >&2
  exit 1
fi

if [[ ! -f "$DMG_BACKGROUND_SOURCE_PATH" ]]; then
  echo "Missing macOS DMG background at $DMG_BACKGROUND_SOURCE_PATH" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "sips is required to generate macOS icons." >&2
  exit 1
fi

if ! command -v iconutil >/dev/null 2>&1; then
  echo "iconutil is required to generate macOS icons." >&2
  exit 1
fi

rm -rf "$GENERATED_ICON_DIR"
mkdir -p "$ICONSET_PATH"

# Generate the full macOS iconset from the checked-in source image.
sips -z 16 16 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_16x16.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_16x16@2x.png" >/dev/null
sips -z 32 32 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_32x32.png" >/dev/null
sips -z 64 64 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_32x32@2x.png" >/dev/null
sips -z 128 128 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_128x128.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_128x128@2x.png" >/dev/null
sips -z 256 256 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_256x256.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_256x256@2x.png" >/dev/null
sips -z 512 512 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_512x512.png" >/dev/null
sips -z 1024 1024 "$SOURCE_ICON_PATH" --out "$ICONSET_PATH/icon_512x512@2x.png" >/dev/null

iconutil -c icns "$ICONSET_PATH" -o "$GENERATED_ICON_DIR/icon.icns"
sips -z 512 512 "$SOURCE_ICON_PATH" --out "$GENERATED_ICON_DIR/icon.png" >/dev/null
sips -s format png "$DMG_BACKGROUND_SOURCE_PATH" --out "$GENERATED_ICON_DIR/dmg-background.png" >/dev/null
rm -rf "$ICONSET_PATH"
