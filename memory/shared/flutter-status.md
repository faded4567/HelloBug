# Flutter Status

Updated: 2026-06-24

## How To Use This File

- `docs/app-remaining-work.md` is the single task-status truth.
- `docs/flutter-tasks.md` is the milestone and acceptance-plan document.
- `memory/claude-current.md` is the small-session startup file for Claude.
- This file is the reality check for Claude Code: it reconciles `docs/flutter-tasks.md`, `docs/wireframes/index.html`, and the current `app/` code.
- When the task touches Flutter, read this file before assuming the milestone labels in `docs/flutter-tasks.md` still match the codebase.

## High-Level Reality

- Flutter is no longer blocked by “missing pages”; the bigger blockers are runtime wiring, backend capability gaps, and the unfinished security boundary.
- Both HTML and Flutter now point at a 2-tab root shell, not the older 3-tab assumption.
- That 2-tab shell is still transitional:
  - Flutter has 2 root branches
  - the first tab is labeled `工作区`
  - but it still mounts `SessionsPage`
- Pairing, history, file preview, and terminal are all beyond mock-only state now.
- Pairing-code TTL is configuration-driven; do not hardcode `30 秒` or `5 分钟` into new Flutter logic.

## Verified Runtime Flow

- `PairingEntryPage` supports inline manual code entry and QR path.
- `PairingController` can complete `device.pair -> device.pair.sas -> device.pair.confirm -> auth.token`, persist runtime, and install a live `WsClient`.
- `bootstrap()` restores persisted runtime and auto-connects when JWT/server state exists.
- `HelloBugApp` now attaches `TransportLifecycleObserver`, so foreground resume can trigger reconnect.
- `danger.pending` is now globally listened to in `app.dart` and opens `DangerConfirmSheet`.
- `NewSessionFlow` sends formal `session.start { session_id, workspace_path, agent_type, resume_session_id }`.
- Shell sessions route to `/terminal/:sessionId`.
- Recent LAN validation already proved the dev-mode chain `pairing -> SAS -> shell session -> PTY input/output` works end to end.

## Global Blockers

1. Security boundary is still incomplete:
   - app sends `Envelope`
   - server bridges envelope frames in development mode
   - daemon still talks plain `Message`
   - `noise_ik.dart` and `session_cipher.dart` are still stubs
2. Push/pinning/runtime persistence are only partially done:
   - push token reporting is not wired
   - server pin persistence/use is not wired
   - JWT refresh exists, but the full secure reconnect story is not finished
3. Backend capability gaps still block Flutter pages:
   - daemon now has real `templates.list`
   - daemon now has real `slash.list`
   - `session.agent.add` still has no final multi-agent runtime behavior, but it now returns an explicit not-implemented error
4. Workspace semantics and device management are still incomplete:
   - root tab semantics are transitional
   - workspace home/settings/state pages are still missing as live flows
   - device rename/revoke/refresh flows are not complete

## M1 Reality

- App skeleton is present: `main.dart`, `bootstrap.dart`, `app.dart`, router, models, theme, providers.
- Transport scaffold is live enough for real development-mode pairing and session work:
  - `WsClient` supports connect, reconnect, `auth.attach`, envelope/plain decode, and `session.resume`
  - runtime restore and live client injection both exist
  - resume reconnect observer is attached
  - `PinnedHttpClient` is still placeholder
- Crypto is still partial:
  - `keys.dart`, `secure_store.dart`, `nonce_counter.dart`, `envelope_signer.dart` exist
  - `noise_ik.dart` and `session_cipher.dart` are still stubs
  - envelope `sig` is still empty
- Pairing is partially real:
  - inline manual pairing happens in `pairing_entry_page.dart`
  - `manual_pair_page.dart` is still a standalone visual variant, not the active flow
  - daemon metadata such as `machineName` / `os` has started to persist
  - missing pieces are push token, pin persistence, and real E2EE session setup
- Unlock is intentionally relaxed right now:
  - `UnlockGate` wraps the router
  - app currently starts unlocked by default
  - timeout-based re-lock is effectively disabled for now
- Devices are provider-backed:
  - `devicesProvider` listens to `device.status`
  - persisted paired daemon metadata can be restored into the list

## M2 Reality

- These are real and should not be treated as blank:
  - `SessionsPage`
  - `NewSessionFlow`
  - `ChatPage` / `ChatTimeline` / `ChatInputBar`
  - `HistoryListPage` / `HistoryDetailPage`
  - `DangerConfirmSheet`
  - workspace switch sheet
  - slash palette UI
  - settings and device detail entry pages
- `NewSessionFlow` no longer uses a dev fake-device fallback.
- History already uses formal `history.list` / `history.get` and can parse basic Claude transcript JSONL.
- `danger.pending` is already globally wired; the remaining gap is timeout/handled/error state cleanup.
- Template UI still uses local/static data even though daemon template support now exists.
- Slash palette already has daemon backend support; remaining work is richer client behavior and multi-agent semantics.

## M3 Reality

- File tree is already using formal `fs.tree.req { session_id, workspace_path, dir_path }`.
- File preview is already using formal `fs.file.req` and client-side base64url decode.
- Diff UI/code already exists in the repo.

## M3 Gaps

- File preview still needs large-file / binary / permission states, plus better highlighting/virtualization.
- File tree still needs fuller workspace/session coupling and better empty/error handling.
- Diff still needs final backend event/data semantics and degradation rules.

## M4 Reality

- Terminal is already wired to the formal PTY path:
  - app sends `pty.input`
  - app listens to `session.event` where `event_type == pty.data`
- Image input exists with chunked upload flow.
- Voice input UI exists and is connected to the chat entry path.
- Settings/security/notifications/templates/relay/device-detail/about/appearance pages all exist as first-pass routes.

## M4 Gaps

- No push-token registration flow is wired yet.
- No multi-session concurrent tab behavior is finished yet.
- Terminal still lacks read-only / permission-denied / exited-state UX cleanup.
- Security / relay / templates / notifications / device-detail pages still rely heavily on mock or local-only data.

## Best Read Order For Claude

- For Flutter implementation work:
  1. Read `memory/claude-current.md`.
  2. Read this file.
  3. Open only the exact `app/lib/...` files involved, including `state/`, `transport/`, `crypto/`, and `router/bootstrap` when needed.
  4. Open `docs/wireframes/index.html` and the target wireframe file when you need visual details.
  5. Open `docs/flutter-tasks.md` only when you need planned acceptance criteria or milestone intent.
