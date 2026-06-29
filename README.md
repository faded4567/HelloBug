# HelloBug

HelloBug is a mobile-first remote control app for local coding agents. The Flutter app lives in `app/`, the product and protocol docs live in `docs/`, and the Node backend workspace lives in `packages/`.

## Repository Layout

```text
HelloBug/
├── app/         # Flutter client owned by Claude
├── docs/        # Planning, protocol, and task docs
├── packages/    # Node workspace owned by Codex
├── CLAUDE.md
└── README.md
```

The backend workspace root is `packages/`, which contains:

- `package.json`
- `pnpm-workspace.yaml`
- `tsconfig.base.json`
- `eslint.config.mjs`
- `.prettierrc.json`
- `pnpm-lock.yaml`
- `protocol/`
- `server/`
- `daemon/`

## Common Commands

From the repository root:

```bash
pnpm -C packages install
pnpm -C packages build
pnpm -C packages test
pnpm -C packages lint
pnpm -C packages --filter @hellobug/server dev
pnpm -C packages --filter @hellobug/daemon dev
pnpm -C packages test:server:relay
pnpm -C packages test:daemon:v1
pnpm -C packages test:v1:backend
```

Backend local debug, LAN relay, bootstrap token, and daemon env startup examples are in [docs/backend-runbook.md](/Users/shuai/yangshuai/projects/HelloBug/docs/backend-runbook.md).

Flutter stays separate:

```bash
cd app
flutter pub get
flutter test
flutter run
```

## Current Ownership

- `app/`: Flutter UI, frontend UX, and copy
- `packages/`: protocol, daemon, server, and backend tooling
- `docs/`: planning, protocol, and milestone tracking
