#!/usr/bin/env bash
set -euo pipefail

root_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$root_dir"

website_pid=""
desktop_pid=""

cleanup() {
  if [[ -n "$website_pid" ]]; then
    kill "$website_pid" 2>/dev/null || true
  fi

  if [[ -n "$desktop_pid" ]]; then
    kill "$desktop_pid" 2>/dev/null || true
  fi

  if [[ -n "$website_pid" ]]; then
    wait "$website_pid" 2>/dev/null || true
  fi

  if [[ -n "$desktop_pid" ]]; then
    wait "$desktop_pid" 2>/dev/null || true
  fi
}

trap cleanup EXIT INT TERM

npm run dev:website &
website_pid=$!

npm run dev:desktop &
desktop_pid=$!

while true; do
  if ! kill -0 "$website_pid" 2>/dev/null; then
    wait "$website_pid"
    exit $?
  fi

  if ! kill -0 "$desktop_pid" 2>/dev/null; then
    wait "$desktop_pid"
    exit $?
  fi

  sleep 1
done
