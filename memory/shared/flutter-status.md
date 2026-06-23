# Flutter Status

Updated: 2026-06-23

## How To Use This File

- `docs/app-remaining-work.md` is the single task-status truth.
- `docs/flutter-tasks.md` is still the milestone and acceptance-plan document.
- `memory/claude-current.md` is the small-session startup file for Claude.
- Claude now owns the entire Flutter client, not just the UI layer.
- This file is the reality check for Claude Code: it reconciles `docs/flutter-tasks.md`, `docs/wireframes/index.html`, and the current `app/` code.
- When the task touches Flutter, read this file before assuming the milestone labels in `docs/flutter-tasks.md` still match the codebase.

## High-Level Reality

- `docs/wireframes/index.html` is currently valid again: 57 nodes, 70 edges, no missing files, no bad refs, no isolated nodes.
- Flutter is no longer "mostly placeholder UI". M1 is visually far along, and large parts of M2, M3, and M4 already exist in code.
- The root navigation direction has changed again: both HTML and Flutter now point at a 2-tab shell, not the older 3-tab root assumption.
- That 2-tab landing is still only partially semantic:
  - Flutter now has 2 shell branches
  - but the first branch still mounts `SessionsPage`
  - while `RootTabScaffold` labels that tab as `工作区`
- The main reason the app is not truly live yet is runtime wiring and protocol alignment, not lack of screens.
- `flutter analyze` in `app/` currently has no build-blocking errors, but it still reports 11 warning/info issues.

## Global Blockers

1. Transport is still split at the security boundary:
   - app sends `Envelope`
   - server and daemon still work with plain `Message`
2. App crypto is still incomplete in practice:
   - `app/lib/crypto/noise_ik.dart` is a stub
   - `app/lib/crypto/session_cipher.dart` is a stub
   - `app/lib/transport/ws_client.dart` can still fall back to base64-wrapped plaintext in development mode
3. `wsClientProvider` still defaults to `null`, but the app is no longer hard-wired to stay that way:
   - `bootstrap()` restores persisted runtime and installs a real `WsClient` when JWT/server/device state exists
   - pairing success also installs a live `WsClient`
   - pinning, app lifecycle reconnect wiring, and push registration are still incomplete
4. App-side protocol naming is mostly aligned now, but file preview is still out of sync with `docs/protocol.md`:
   - current code still sends `fs.read`
   - current code still reads `fs.file.payload.content`
   - protocol standard is `fs.file.req` + `data`
5. Security/settings/device-detail/voice-input UI now exist, but runtime wiring is still incomplete:
   - push registration is still not wired
   - multi-tab and dedicated workspace home/settings/state pages are still missing
   - the new 2-tab root shell is only partially aligned with final workspace semantics
   - several newer pages still show mock data only

## M1 Reality

- 1.1 app skeleton is present: `main.dart`, `bootstrap.dart`, `app.dart`, router, models, theme, providers.
- Root navigation no longer matches the older `device | session | settings` assumption:
  - app root is `CupertinoApp.router`
  - tab shell is `GoRouter` `StatefulShellRoute.indexedStack` + custom `RootTabScaffold`
  - current shell has 2 branches
- 1.2 theme system is present and actively used.
- 1.3 transport scaffold exists:
  - `WsClient` supports connect, reconnect, `auth.attach`, message encode/decode, and `session.resume` replay bookkeeping
  - `PinnedHttpClient` is still placeholder
  - bootstrap/pairing now provide a basic real client injection path, but lifecycle observers are not wired
- 1.4 crypto is only partially real:
  - `keys.dart`, `secure_store.dart`, `nonce_counter.dart`, `envelope_signer.dart` exist
  - `noise_ik.dart` and `session_cipher.dart` are still stubs
  - `sig` is still empty in `Envelope`
- 1.5 onboarding flow exists.
- 1.6 pairing is partially real, not a pure stub anymore:
  - `PairingEntryPage` supports inline manual code entry plus QR path
  - `QrScanPage` is real and uses `mobile_scanner`
  - `PairingController` now sends `device.pair`, waits for `device.pair.sas`, sends `device.pair.confirm`, waits for `auth.token`, persists runtime, and installs a live `WsClient`
  - missing pieces: `device.push_token`, pin persistence/use, richer device metadata persistence, real E2EE session setup
  - `manual_pair_page.dart` now implements the intended wireframe and has input / connecting / error visual states, but it is still a standalone visual variant and does not drive the active pairing flow
- 1.7 unlock is only partially live:
  - `HelloBugApp` now wraps the router with `UnlockGate`
  - current code starts in unlocked state by default
  - `AppLifecycleObserver` exists, but is not attached in bootstrap, so timeout-based re-lock is currently inactive
- 1.8 device list is no longer a hardcoded stub:
  - `devicesProvider` listens to `device.status`
  - `DevicesPage` renders provider-backed cards
  - `DeviceDetailPage` and the device-detail route now exist
  - missing pieces: revoke/rename flows, refresh/error states, and settings entry wiring

## M2 Reality

These parts already exist in code and should not be treated as blank:

- state/providers:
  - `sessions_provider.dart`
  - `chat_provider.dart`
  - `devices_provider.dart`
  - `drafts_provider.dart`
  - `settings_provider.dart`
- sessions UI:
  - `SessionsPage`
  - `SessionTile`
  - during the current 2-tab transition, `SessionsPage` is still the content mounted under the first root-shell branch
- new-session flow:
  - 3-step device/workspace/agent flow exists
  - optimistic local session summary exists
  - sends `session.start`
  - still includes a dev-only fake device fallback when no devices exist
- chat UI:
  - `ChatPage`
  - `ChatTimeline`
  - `ChatInputBar`
  - message bubbles, thinking cards, tool cards, diff cards
- slash commands:
  - slash palette UI and controller exist
  - requests `slash.list`
- history:
  - `HistoryListPage`
  - `HistoryDetailPage`
  - paged fetch flow exists
- session info:
  - `SessionInfoSheet` exists and is reachable from the chat header
- danger rules:
  - `DangerRulesPage` exists
  - rules are editable in app state
- workspace switch:
  - switch sheet exists
  - recent/pinned workspace history persists via secure storage
- danger confirm:
  - `DangerConfirmSheet` exists
  - can send `danger.allow` / `danger.deny`

## M2 Gaps

- `danger.pending` is not yet wired to a global listener that automatically opens `DangerConfirmSheet`.
- Template chips are still static `kDefaultTemplates`; `TemplatesPage` and its local form sheet exist, but there is no real `templates.list` or persisted template store yet.
- `ImageInputSheet` exists, and chat input now has image and voice entry buttons wired in.
- Workspace switching UI exists, but actual session/filetree/diff context rerouting is still incomplete.
- Provider event modeling is still shallow and may not match final backend payloads.

## M3 Reality

- Diff work is already real in code:
  - `app/lib/diff/`
  - `screens/diff/`
  - `screens/diff_spike/`
  - `widgets/diff_card.dart`
- File tree work is already real in code:
  - `FileTreePage`
  - `FileTreeController`
  - `TreeCache`
  - `TreeNodeTile`
  - `FilePreviewPage`

## M3 Gaps

- File preview protocol is still out of sync with the current spec:
  - sends `fs.read`
  - expects `content`
- File preview still lacks decoding/highlighting/large-file virtualization.
- File tree is still waiting on stable backend contract and fuller workspace/session wiring.

## M4 Reality

- Terminal page exists and is already hooked to PTY message flow:
  - `TerminalPage`
  - `PtySessionController`
  - `TerminalToolbar`
- `TerminalStatusBar` exists as a standalone widget, though it is not mounted in `TerminalPage` yet.
- Image input exists:
  - picker UI
  - compression
  - chunked `session.input.image` upload
- Voice input UI now exists:
  - `VoiceInputSheet`
- Additional settings/device UI now exist:
  - `SecurityPage`
  - `NotificationsPage`
  - `TemplatesPage`
  - `RelaySettingsPage`
  - `DeviceDetailPage`
  - `SessionInfoSheet`
- Appearance page exists.
- About page exists.
- Slash palette exists.
- Settings home now routes to security, notifications, templates, relay, history, appearance, about, and diff spike.

## M4 Gaps

- No multi-tab concurrent session UI exists yet.
- No push-token registration flow is wired yet.
- Terminal still lacks read-only / permission-denied / exited-state UI, and `TerminalStatusBar` is not mounted yet.
- Notification settings page exists, but no real permission or push-token flow is wired yet.
- Security / relay / templates / device-detail pages still mostly show mock data or local-only state.
- Workspace home/settings/state pages are still missing as real routed screens, even though the root shell has already moved toward a 2-tab workspace/settings information architecture.

## Best Read Order For Claude

- For Flutter implementation work:
  1. Read `memory/claude-current.md`.
  2. Read this file.
  3. Open only the exact `app/lib/...` files involved, including `state/`, `transport/`, `crypto/`, and `router/bootstrap` when needed.
  4. Open `docs/wireframes/index.html` and the target wireframe file when you need visual details.
  5. Open `docs/flutter-tasks.md` only when you need planned acceptance criteria or milestone intent.
