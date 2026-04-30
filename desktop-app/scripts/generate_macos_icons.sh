#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

SOURCE_ICON_PATH="src/renderer/assets/default-app-icon.png"
DMG_BACKGROUND_SOURCE_PATH="packaging/macos/assets/dmg-background.svg"
GENERATED_ICON_DIR="packaging/macos/generated-icons"

if [[ ! -f "$SOURCE_ICON_PATH" ]]; then
  echo "Missing macOS source icon at $SOURCE_ICON_PATH" >&2
  exit 1
fi

if [[ ! -f "$DMG_BACKGROUND_SOURCE_PATH" ]]; then
  echo "Missing macOS DMG background at $DMG_BACKGROUND_SOURCE_PATH" >&2
  exit 1
fi

if ! command -v sips >/dev/null 2>&1; then
  echo "sips is required to generate macOS DMG backgrounds." >&2
  exit 1
fi

if ! command -v cargo-tauri >/dev/null 2>&1; then
  echo "tauri-cli is required to generate macOS icons. Install with: cargo install tauri-cli --locked" >&2
  exit 1
fi

rm -rf "$GENERATED_ICON_DIR"
mkdir -p "$GENERATED_ICON_DIR"

# Generate the packager icon files from the checked-in source image.
cargo tauri icon "$SOURCE_ICON_PATH" --output "$GENERATED_ICON_DIR"
sips -s format png "$DMG_BACKGROUND_SOURCE_PATH" --out "$GENERATED_ICON_DIR/dmg-background.png" >/dev/null
sips -s format png -z 760 1080 "$DMG_BACKGROUND_SOURCE_PATH" --out "$GENERATED_ICON_DIR/dmg-background@2x.png" >/dev/null
