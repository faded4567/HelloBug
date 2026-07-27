#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
cd "$SCRIPT_DIR"

if ! command -v pnpm >/dev/null 2>&1; then
  echo "pnpm is required; installing pnpm 10.12.1..."
  npm install -g pnpm@10.12.1
fi

if [ ! -d node_modules ]; then
  pnpm install --prod --frozen-lockfile
fi

exec node packages/daemon/dist/index.js
