# Protocol Decisions

Updated: 2026-06-22

These are the stable decisions worth loading before opening the full protocol doc.

## Source Of Truth

- `docs/protocol.md` is the only field-level protocol source of truth.
- `docs/codex-tasks.md` and `docs/flutter-tasks.md` should describe responsibilities and acceptance, not redefine protocol fields.

## Confirmed Decisions

- `fs.file` uses `data`, not `content`.
- `daemon.hello` is a first-class protocol message.
- `device.pair.sas` and `device.pair.confirm` are first-class protocol messages.
- `error` is a first-class common message.
- `notification.push` should be treated as push payload spec, not a normal WebSocket runtime message.

## Auth Model

- No account/password system.
- Remove `auth.login` and `auth.logout`.
- Daemon authenticates with device certificate after bootstrap registration.
- App authenticates with paired-device JWT plus refresh flow.

## Bootstrap Flow

1. Daemon generates local device key material.
2. Daemon uses `POST /v1/register` to obtain device cert material.
3. Daemon connects to relay.
4. Daemon sends `daemon.hello`.
5. Daemon creates local pairing code and pairing slot.
6. App pairs through the relay.

## E2EE Rules To Preserve

- Intended frame shape is `Envelope -> ciphertext -> InnerMessage`.
- Key rotation rule is `100 messages OR 10 minutes`, whichever comes first.
- `key.ratchet` and `key.ratchet_ack` remain explicit protocol messages.

## Current Divergence

Current code has not fully caught up with these decisions. Check `memory/shared/current-status.md` before assuming the implementation matches the spec.
