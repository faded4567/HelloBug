# Current Status

Updated: 2026-06-29

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
- Flutter 侧已补 `device.list / device.rename / device.revoke`、`workspace.list / workspace.resolve`，并且本地 push token 会在 pairing 成功或后续 `auth.token` 时自动上报 `device.push_token`；iOS native APNS bridge 与 Android native FCM bridge 都已接入，Android 当前按 `manufacturer=Other` 上报，运行时仍需 `app/android/app/google-services.json`。
- daemon -> server `push.trigger` 已正式落地，server 现在会校验 session 归属、过滤在线 app，只向离线且仍保留有效 push route 的 app 设备派发；`packages/server/src/push/` 也已补 provider-ready 骨架、noop provider 与 invalid-token cleanup，便于后续接 APNS / Android 厂商 HTTP。
- workspace discovery is now a bit richer on the daemon side: besides `is_empty / repo_root / git_branch`, `workspace.resolve` now also returns `status_reason / access_mode / repair_hint`, so the app can tell apart missing paths, non-directories, outside-allowed paths, and permission problems, and can surface a suggested fallback path when one exists.
- server 现在会在 `session.start.result(started)` 与 `session.done` 时同步广播 `device.status.active_session_count`；已完成会话会保留 session ownership 与 replay buffer，因此 daemon 离线后仍可 `session.resume` 回放。
- server 已修正 `device.status` 时间语义：`ts` 是本次状态广播时间，`last_seen_at` 只在设备真实在线/离线切换时前进；离线设备被重命名时，server 也会把新的 `machine_name` 广播给所有关联 app，而不会伪刷新“最近在线时间”。
- server 现在也会主动失败挂起请求：daemon 中途断线时会立刻失败；daemon 保持在线但迟迟不回包时，pending `session.start` 会超时回 rejected，pending `workspace.list / workspace.resolve / history.list / templates.list / history.get / slash.list` 会超时回 `SESSION_NOT_FOUND`；超时后的迟到回包也会被丢弃，不再误发给其他 app。
- server 现在也会把 `fs.tree.req / fs.file.req` 纳入同一套 pending/timeout 闭环：daemon 在线但不回包时，App 会收到结构化超时错误；若 daemon 迟到再发 `fs.tree / fs.file`，server 会直接丢弃。`fs.file` 的多 chunk 响应也已按 request 生命周期正确处理。
- 文件预览链路现在已有正式状态语义：daemon `fs.file` 会显式返回 `ready / binary / too_large / permission_denied / not_found`；Flutter 预览页已承接这些状态，并继续保留 `SESSION_NOT_FOUND / WORKSPACE_FORBIDDEN` 的结构化错误分流。
- 图片输入链路现在也补了第一轮 daemon 失败语义：非 `image/*` MIME、超过 2MB 的上传会被直接拒绝；如果当前 runtime 不支持图片输入，daemon 会返回结构化 `error`，不再只是本地日志报错。
- daemon 现在还会对入站加密消息的 schema/解密后校验失败返回结构化 `error`；过去这类问题只会在 daemon 终端看到 `ZodError`，现在 App 也能直接收到失败回执。
- diff 链路现在已有 daemon 真后端第一版：Claude `Write / Edit / MultiEdit` 成功修改工作区内文本文件后，daemon 会基于前后快照下发 `file.changed { file_path, diff, added, removed }`；越界路径、非文本、超大文件、无实际变更、失败结果当前都保守降级为“不发 diff 事件”。
- daemon 现在支持纯环境变量启动：缺少 `~/.hellobug/daemon.json` 时，只要提供 `HELLOBUG_DAEMON_SERVER_URL` 等覆盖项即可启动；server/daemon 本地联调与回归命令已集中到 `docs/backend-runbook.md` 和 `packages/package.json`。
- relay 现在也不再自动兼容旧版 `session.start` 缺省 `resume_session_id`、旧版 slash 单字符串 `args` 与旧版 `fs.tree.req.path` 请求体；当前协议已要求三端统一发送正式 payload。
- The repo is in active development and `app/` currently has many user changes in progress.

## Important Reality Check

The design docs describe E2EE with `Envelope + ciphertext + Noise IK`, but the runtime is still only partially aligned:

- Flutter `WsClient` sends `Envelope`.
- Flutter pairing / bootstrap / restored runtime clients already sign `Envelope` with local Ed25519 identity keys.
- Flutter no longer silently falls back to base64-wrapped plaintext for non-bootstrap runtime traffic when crypto is missing; only pairing/auth/device/session.resume placeholder paths can proceed without per-session crypto injection, and the default paired runtime wires real crypto.
- Flutter `noise_ik.dart`, `session_cipher.dart`, pairing-derived session bootstrap, and explicit `key.ratchet` are already implemented.
- Server relay already has a staged `Envelope` bridge:
  - it can detect `Envelope`
  - preserve and forward signed source envelopes when the payload stays formal
  - verify daemon/app envelope signatures when an envelope is present
  - base64url-decode plaintext-envelope `ciphertext` when it must inspect the inner `Message`
  - route `noise_static_v1` traffic by outer metadata without decrypting the business payload
- But that bridge is still development-mode transport:
  - session traffic plus `workspace.list / workspace.resolve / history.list / templates.list` now ride opaque envelope channels (`transport.control.v1` for the non-session path)
  - `session.resume` now rides `noise_static_v1` with outer `routing_payload`, and `replay.done` now uses an opaque placeholder envelope for envelope clients
  - server-originated `session.start.result(rejected)` now also uses an opaque placeholder envelope for envelope clients
  - encrypted `session.start` now also records a session-level `requiresEncryptedTransport` bit on the relay path, so daemon `session.start.result` can no longer downgrade back to plain without the server converting it into `session.start.result(rejected, code=PROTOCOL_VERSION)`
  - the same session-level rule now also applies after startup for daemon->app runtime traffic such as `session.event / danger.pending / danger.result / fs.tree / fs.file / history.get / slash.list / key.ratchet / key.ratchet_ack / error(session-scoped)`, which are converted to `error(PROTOCOL_VERSION)` instead of being forwarded as plain session data
  - explicit `key.ratchet` / `key.ratchet_ack` now also ride encrypted session transport; `key.ratchet` is sent with the pre-rotation cipher, and `key.ratchet_ack` returns on the post-rotation cipher
  - server-originated `device.status` and `error` now also use opaque placeholder envelopes for envelope clients
  - `daemon.hello / auth.attach / auth.refresh / auth.token / device.push_token / device.list / device.rename / device.revoke` now also ride outer-`routing_payload` placeholder envelopes on envelope clients
- `device.pair.ready / device.pair / device.pair.sas / device.pair.confirm` now also ride placeholder envelopes; pairing is still pre-session bootstrap, but it no longer falls back to plain inner messages
- `replay.done` is now explicitly server-only: the relay still generates it for `session.resume`, but daemon-originated `replay.done` is rejected instead of being treated as a routable daemon->app message
- once a relay socket switches to envelope mode, server now rejects falling back to plain inner messages on that same connection
  - inbound envelope transport sequence is now enforced as strictly increasing per connection; replay cursors (`session.resume.last_seq` / `replay.done.current_seq`) are tracked against replayed envelope transport sequence, not `session.event.payload.seq`
  - signed envelopes whose `ts` skew exceeds ±5 minutes are now rejected, and the same signed envelope cannot be replayed verbatim on a fresh relay connection while it is still within that valid window
  - modern metadata-bearing envelopes for `auth.attach / auth.refresh / daemon.hello / device.pair.* / device.push_token / device.list / device.rename / device.revoke / session.resume / key.ratchet / key.ratchet_ack` are now also blocked from downgrading back to `cipher_mode=plain`
  - legacy raw JSON `auth.attach / auth.refresh / daemon.hello / device.push_token / device.list / device.rename / device.revoke / session.resume / session.start / session.agent.add / session.input* / session.command.slash / session.cancel / danger.allow / danger.deny / workspace.list / workspace.resolve / history.list / history.get / templates.list / key.ratchet / key.ratchet_ack / danger.pending / danger.result / session.event / fs.tree.req / fs.file.req / fs.tree / fs.file / slash.list / pty.input / pty.resize` are no longer accepted on the relay path; V1 bootstrap and direct-control paths no longer rely on raw JSON, and the remaining compatibility surface is now mostly a few temporary development-era plain-envelope leftovers
  - plaintext envelopes for `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list / session.start / danger.allow / session.event / replay.done / session.start.result / danger.result / fs.tree / fs.file` now also require explicit outer `message_type + cipher_mode=plain`, and the outer `message_type` must match the inner message type
  - modern metadata-bearing app runtime request envelopes are now also blocked from downgrading back to `cipher_mode=plain`, including `session.start / session.agent.add / session.input* / session.command.slash / session.cancel / danger.allow / danger.deny / fs.tree.req / fs.file.req / pty.input / pty.resize` and request variants `workspace.list / workspace.resolve / history.list / history.get / templates.list / slash.list`; the remaining compatibility is now mostly a few older development-era plain-envelope paths
  - non-session direct control requests (`workspace.list / workspace.resolve / history.list / templates.list`) now also reject metadata-bearing plain requests, and encrypted control/session-utility requests (`workspace.list / workspace.resolve / history.list / templates.list / history.get / slash.list`) can no longer receive a daemon plain response downgrade without the server converting it into `error(PROTOCOL_VERSION)` while preserving `session_id` where applicable
  - relay framing-stage protocol shape errors now also report back as `PROTOCOL_VERSION` instead of being lumped into `AUTH_INVALID`; true auth/signature failures still remain `AUTH_INVALID`
  - relay/path pinning and the remaining development-mode fallback paths are not complete
- Daemon transport already sends signed `Envelope`, and session-whitelisted messages can upgrade to `noise_static_v1`.
- Daemon encrypted `session.start.result` now also carries a minimal outer status hint for relay routing, while Flutter prefers decrypting the real ciphertext whenever `sender_pubkey` is present.
- Daemon encrypted `session.event` now also carries a minimal outer routing hint, so the relay can detect `session.done` and update `active_session_count` without decrypting runtime ciphertext.
- The relay now treats outer routing hints as required for key encrypted session-state messages: `session.start / session.start.result / session.event / danger.allow / danger.deny / danger.pending / danger.result` are rejected at framing time if `routing_payload` is missing, instead of falling back to guessed placeholder payloads.
- Daemon encrypted session-scoped `error` messages now also include outer `routing_payload`, and the relay now requires that hint too; opaque runtime failures can still be routed structurally without reverting to plain inner messages, while the older missing-routing fallback is gone.
- The relay no longer accepts legacy envelope signatures that omit `routing_payload` from the signed payload.
- Raw JSON `session.start.result / replay.done / error` relay messages are now also rejected; these response paths are envelope-only.
- The relay now also rejects true `noise_static_v1` business envelopes that omit `sender_pubkey`, so it no longer forwards ciphertext that the receiving runtime cannot possibly decrypt; placeholder control envelopes that are intentionally consumed via outer `routing_payload` remain exempt.
- Workspace discovery responses now include basic `is_empty / repo_root / git_branch` metadata for future app workspace-home wiring, and `workspace.resolve` now also carries `status_reason / access_mode / repair_hint` for workspace-recovery flows.

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

- finishing the security boundary around the already-staged envelope transport
- daemon now has `templates.list` / `slash.list`, and `session.agent.add` returns an explicit not-implemented error instead of failing silently
- app template UI is now reading daemon `templates.list` and still supports local override/delete persistence; the next client-side step is deeper slash/template error-state polish and final storage-boundary decisions
- app-side `device.push_token` reporting and device management are now partially wired; the Android token path is now present through a native FCM bridge, but real push delivery, Firebase runtime config, and Android vendor-channel routing are still incomplete even though the server now persists push tokens when it receives them

Unifying that boundary and filling those daemon/server gaps is the key step before claiming real mobile-to-daemon encrypted transport and complete app functionality.
