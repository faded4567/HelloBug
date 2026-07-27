#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
VERSION="${1:-$(node -p "require('$REPO_ROOT/packages/daemon/package.json').version")}"
OUTPUT_DIR="$REPO_ROOT/dist/release"
ARCHIVE_NAME="hellobug-daemon-${VERSION}"

if [[ ! "$VERSION" =~ ^[0-9]+\.[0-9]+\.[0-9]+([-.][0-9A-Za-z.-]+)?$ ]]; then
  echo "Version must be a semantic version, received: $VERSION" >&2
  exit 1
fi

npm --prefix "$REPO_ROOT/packages" run build:daemon

STAGING_DIR="$(mktemp -d)"
trap 'rm -rf "$STAGING_DIR"' EXIT
BUNDLE_DIR="$STAGING_DIR/$ARCHIVE_NAME"

mkdir -p "$BUNDLE_DIR/packages/daemon" "$BUNDLE_DIR/packages/protocol" "$OUTPUT_DIR"
cp "$REPO_ROOT/packages/package.json" \
  "$REPO_ROOT/packages/pnpm-lock.yaml" \
  "$REPO_ROOT/packages/pnpm-workspace.yaml" \
  "$BUNDLE_DIR/packages/"
cp "$REPO_ROOT/packages/daemon/package.json" "$BUNDLE_DIR/packages/daemon/"
cp "$REPO_ROOT/packages/protocol/package.json" "$BUNDLE_DIR/packages/protocol/"
cp -R "$REPO_ROOT/packages/daemon/dist" "$BUNDLE_DIR/packages/daemon/"
cp -R "$REPO_ROOT/packages/protocol/dist" "$BUNDLE_DIR/packages/protocol/"
cp "$REPO_ROOT/deploy/daemon/README.md" "$BUNDLE_DIR/README.md"
cp "$REPO_ROOT/deploy/daemon/start.sh" "$BUNDLE_DIR/start.sh"
chmod +x "$BUNDLE_DIR/start.sh"

tar -czf "$OUTPUT_DIR/$ARCHIVE_NAME.tar.gz" -C "$STAGING_DIR" "$ARCHIVE_NAME"
(cd "$OUTPUT_DIR" && shasum -a 256 "$ARCHIVE_NAME.tar.gz" > "$ARCHIVE_NAME.tar.gz.sha256")

echo "Created $OUTPUT_DIR/$ARCHIVE_NAME.tar.gz"
echo "Created $OUTPUT_DIR/$ARCHIVE_NAME.tar.gz.sha256"
