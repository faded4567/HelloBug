#!/bin/bash
# ============================================================
# Codex SSD Issue Fix Script
# 1. Upgrade Codex to 0.145.0
# 2. Set RUST_LOG=error to suppress TRACE logging
# 3. Clean up corrupted logs database
# ============================================================
set -e

echo "=== Codex SSD Fix ==="
echo ""

# ── Step 1: Upgrade Codex ──────────────────────────────────
echo "[1/4] Upgrading Codex to 0.145.0..."
npm install -g @openai/codex@0.145.0
echo "✓ Codex upgraded"
codex --version
echo ""

# ── Step 2: Set RUST_LOG in shell profile ──────────────────
echo "[2/4] Adding RUST_LOG=error to ~/.zshrc..."
if grep -q "RUST_LOG" ~/.zshrc 2>/dev/null; then
    sed -i '' 's/export RUST_LOG=.*/export RUST_LOG=error/' ~/.zshrc
    echo "✓ Updated existing RUST_LOG"
else
    echo 'export RUST_LOG=error' >> ~/.zshrc
    echo "✓ Added RUST_LOG=error"
fi
echo ""

# ── Step 3: Clean up corrupted database ─────────────────────
echo "[3/4] Cleaning corrupted logs database..."
cd ~/.codex
# Move corrupted files aside (Codex will recreate them on next start)
for f in logs_2.sqlite logs_2.sqlite-wal logs_2.sqlite-shm state_5.sqlite state_5.sqlite-wal state_5.sqlite-shm; do
    if [ -f "$f" ]; then
        mv "$f" "${f}.corrupt.$(date +%Y%m%d)"
        echo "✓ Moved $f"
    fi
done
echo ""

# ── Step 4: Verify ──────────────────────────────────────────
echo "[4/4] Verifying..."
codex doctor 2>&1 | head -20
echo ""
echo "=== Done! ==="
echo "Please restart your terminal or run: source ~/.zshrc"
echo "The corrupted databases have been moved aside - Codex will recreate them."
echo ""
echo "To verify RUST_LOG is set, run: echo \$RUST_LOG"
