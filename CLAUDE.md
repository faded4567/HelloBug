# CLAUDE.md

HelloBug is a Flutter app that remotely controls a local Claude Code / Codex agent through a cloud relay.

## Current Snapshot

- `docs/app-remaining-work.md` is the single task-status source of truth.
- `docs/protocol.md` is the field-level protocol source of truth.
- `docs/wireframes/` is the UI/spec source of truth.
- `memory/claude-current.md` is the preferred startup file for Claude Flutter work.
- For Flutter work, `memory/shared/flutter-status.md` is the reality check; `docs/flutter-tasks.md` is planning/acceptance and may lag the code.
- Intended transport shape: `Envelope -> ciphertext -> InnerMessage`.
- Current implementation is still split:
  - Flutter app sends `Envelope`.
  - Server relay can bridge app-side `Envelope`, but still in development-mode decode/repack form.
  - Daemon transport still sends plain `Message`.
- Flutter crypto is not complete yet:
  - `app/lib/crypto/noise_ik.dart` is a stub.
  - `app/lib/crypto/session_cipher.dart` is a stub.
  - `app/lib/transport/ws_client.dart` can still fall back to base64-wrapped plaintext in development mode.
- Treat current transport as work in progress, not finished E2EE.
- Highest-priority integration gap: unify app/server/daemon on the same envelope path.
- `app/` may contain unrelated in-progress user changes. Do not revert them.

## Context Rules

- Read extra context only if the task needs it:
  - [memory/claude-current.md](memory/claude-current.md)
  - [memory/shared/current-status.md](memory/shared/current-status.md)
  - [memory/shared/flutter-status.md](memory/shared/flutter-status.md)
  - [memory/shared/protocol-decisions.md](memory/shared/protocol-decisions.md)
- Prefer targeted code reads over large docs.
- `docs/claude-ui-tasks.md` is Flutter scope guidance under a legacy filename, not status truth.
- Avoid loading `docs/protocol.md`, `docs/flutter-tasks.md`, `docs/claude-ui-tasks.md`, `docs/codex-tasks.md`, and `docs/dev-plan.md` together unless the task truly needs cross-doc reconciliation.
- If a session becomes heavy or hits `Prompt is too long`, start a fresh one from `memory/claude-current.md` instead of continuing a bloated thread.
- After a stable decision, update `memory/` instead of relying on long chat history.
