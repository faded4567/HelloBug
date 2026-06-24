# Current Status

Updated: 2026-06-24

## What HelloBug Is

HelloBug has three layers:

1. Flutter app
2. Cloud relay server
3. Local daemon that talks to Claude Code / Codex / shell

The app should talk to the daemon only through the relay.

## What Is Actually Implemented

- `packages/` workspace exists and has protocol, server, and daemon scaffolds.
- Flutter app already has substantial UI and transport scaffolding.
- Pairing, sessions, relay, file/history/terminal 主链路都已有第一版真实实现。
- 最近已验证一轮局域网开发态联调：`pairing -> SAS -> auth.token -> session.start(shell) -> pty.input/pty.resize -> terminal output`。
- The repo is in active development and `app/` currently has many user changes in progress.

## Important Reality Check

The design docs describe E2EE with `Envelope + ciphertext + Noise IK`, but the runtime is still only partially aligned:

- Flutter `WsClient` sends `Envelope`.
- Flutter can still fall back to base64-wrapped plaintext if crypto is not injected.
- Flutter envelope signature is still empty.
- Flutter `noise_ik.dart` and `session_cipher.dart` are stubs.
- Server relay already has a partial app-side `Envelope` bridge:
  - it can detect `Envelope`
  - base64url-decode `ciphertext`
  - validate the inner `Message`
  - reply in `Envelope` form when the socket was using envelope frames
- But that bridge is still development-mode transport:
  - no real payload encryption on the relay path
  - no real signature verification
  - `sig` is still empty
- Daemon transport still sends plain `Message` over WebSocket.

Result: the current chain should still be treated as development-mode transport, not finished end-to-end encryption.

## Documentation Truth

- Task status truth: `docs/app-remaining-work.md`
- Field-level protocol truth: `docs/protocol.md`
- UI/spec truth: `docs/wireframes/`
- Detailed support docs:
  - `docs/flutter-tasks.md`
  - `docs/claude-ui-tasks.md`  # legacy filename, now Claude Flutter scope
  - `docs/codex-tasks.md`
- Shared memory:
  - `memory/shared/current-status.md`
  - `memory/shared/flutter-status.md`
  - `memory/shared/protocol-decisions.md`

## Practical Read Order

- Everyone: read `docs/app-remaining-work.md`, then this file.
- Claude: then read `memory/claude-current.md`, then `memory/shared/flutter-status.md`.
- Codex: then read `memory/codex-current.md`; read `memory/shared/protocol-decisions.md` when protocol/security details matter.
- After that, open only the exact code files involved.
- Avoid loading `docs/protocol.md`, `docs/flutter-tasks.md`, `docs/claude-ui-tasks.md`, and `docs/codex-tasks.md` together unless the task truly needs cross-doc reconciliation.

## Near-Term Priority

The biggest integration blockers are:

- app side `Envelope` vs daemon side plain `Message`
- incomplete app crypto
- daemon now has `templates.list` / `slash.list`, and `session.agent.add` returns an explicit not-implemented error instead of failing silently
- app template UI is still using static `kDefaultTemplates`; the next client-side step is wiring it to the daemon catalog
- app-side `device.push_token` reporting, device management, and real push delivery are still incomplete, even though the server now persists push tokens when it receives them

Unifying that boundary and filling those daemon/server gaps is the key step before claiming real mobile-to-daemon encrypted transport and complete app functionality.
