#!/usr/bin/env bash
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

npm run build
npm run icons:mac
npx electron-builder --config electron-builder.config.cjs --mac "$@"
