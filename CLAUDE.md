# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

HelloBug is a mobile app (Flutter) that lets you remotely control a local Claude Code / Codex agent from your phone. The architecture has three layers communicating via WebSocket:

```
Flutter App (iOS/Android)
    ↕ WebSocket (E2EE, Noise IK)
Cloud Relay Server (Fastify 5 + ws 8)
    ↕ WebSocket (E2EE, Noise IK, reverse connection)
Local Daemon (Node.js 22 + TypeScript)
    ↕ subprocess / PTY
Claude Code / Codex / Shell
```

The Flutter app **never connects directly to the daemon** — all traffic routes through the cloud relay server.

## Repository Structure (planned monorepo)

```
HelloBug/
├── packages/
│   ├── package.json    # Node workspace root for backend tasks
│   ├── pnpm-workspace.yaml
│   ├── tsconfig.base.json
│   ├── protocol/      # Shared TypeScript types + Zod schemas (envelope, messages, events)
│   ├── daemon/        # Local persistent process — connects outbound to relay, spawns agents
│   └── server/        # Cloud relay server — routes envelopes, buffers messages, handles auth
├── app/               # Flutter client (iOS + Android)
└── docs/
    ├── dev-plan.md    # Architecture overview and milestone plan
    ├── codex-tasks.md # Backend task specifications (daemon + server)
    └── wireframes/    # Static HTML UI prototypes (open index.html to browse)
```

## Commands (once scaffolded)

```bash
# Install all workspace packages
pnpm -C packages install

# Build all packages
pnpm -C packages build

# Run tests (Vitest for Node packages)
pnpm -C packages test

# Run tests for a single package
pnpm -C packages --filter @hellobug/daemon test
pnpm -C packages --filter @hellobug/server test

# Run a single test file
pnpm -C packages --filter @hellobug/daemon test src/crypto/keys.test.ts

# Lint
pnpm -C packages lint

# Flutter
cd app && flutter pub get
cd app && flutter test
cd app && flutter run
```

## Tech Stack

| Layer | Technology |
|---|---|
| Flutter App | Flutter 3.27+ / Dart 3.7+, Cupertino UI, Riverpod state management |
| E2EE (Flutter) | `cryptography` package — Noise IK + ChaCha20-Poly1305 |
| E2EE (Node) | `libsodium-wrappers` — Noise IK + Ed25519 signing |
| Daemon | Node.js 22 + TypeScript, local file-backed device keys, `node-pty` for PTY |
| Server | Fastify 5 + `@fastify/websocket`, JWT via `jose`, certs via `node-forge` |
| Schema | Zod (shared between daemon and server via `packages/protocol`) |
| Testing | Vitest for all Node packages |
| Deployment | Caddy (TLS) + systemd, daemon config at `~/.hellobug/daemon.json` |

## Architecture: Critical Contracts

These invariants must hold across the daemon/server/app boundary:

1. **seq is monotonically increasing** per `session_id` — the app uses `last_seq` to request replay of missed messages on reconnect.
2. **`file.changed` events** must include both `file_path` and `diff` (unified diff string).
3. **`fs.file` responses** over 200 KB must be chunked; each chunk carries `chunk_index` and `total_chunks`.
4. **`danger.pending`** pauses agent execution; daemon waits for `danger.allow` or `danger.deny` from the app, auto-denying after 60 seconds.
5. **Push notifications** carry only `session_id` + `event_type` — never code, file content, or user input.
6. **The relay server never decrypts payloads** — it routes encrypted envelopes opaquely.

## Key Design Decisions

- **Daemon initiates the outbound WebSocket** to the relay (reverse connection). The app connects inbound to the relay. This avoids the daemon needing a public IP.
- **Session keys rotate every 100 messages** (ChaCha20-Poly1305); old keys are immediately destroyed.
- **Audit logs** (`~/.hellobug/audit/<date>.jsonl`) are append-only, encrypted with a key derived from the daemon's device key, and rotated daily (retained 30 days). Tool arguments are hashed, not stored in plaintext.
- **Workspace fence** (`daemon/src/guard/fence.ts`) validates all file operation paths against the `allowed_paths` config whitelist before forwarding to the agent.
- **The ring buffer** on the server stores the 500 most recent encrypted envelopes per session (TTL 24h). The server holds no plaintext.

## Scope Boundaries

The project explicitly does **not** include:
- Direct file editing from the phone
- Multi-user collaboration
- Cloud-side persistence of session content (local transcript is source of truth)
- App Store distribution (TestFlight / self-signed APK only)
- Screen sharing or remote desktop
- On-device AI inference

## Development Order

Backend (daemon + server) scaffolds first, Flutter follows per milestone. See `docs/dev-plan.md` for the full milestone plan (M1–M4) and `docs/codex-tasks.md` for detailed backend specs. Wireframes for all screens are in `docs/wireframes/` — open `index.html` to browse them.
