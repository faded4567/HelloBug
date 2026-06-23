# Memory Index

Use this folder as the lightweight handoff layer behind `CLAUDE.md`.

## Status Rule

- `docs/app-remaining-work.md` is the only task-status truth.
- `memory/` stores startup context and stable conclusions, not a second task tracker.

## Read Order

1. `docs/app-remaining-work.md`
2. `memory/shared/current-status.md`
3. One agent startup file:
   - `memory/claude-current.md`
   - `memory/codex-current.md`
4. One focused shared file if needed:
   - `memory/shared/flutter-status.md`
   - `memory/shared/protocol-decisions.md`
5. Only then open the specific code files needed for the task

## Layout

- `memory/shared/`: project facts both Claude Code and Codex should share
- `memory/claude-current.md`: Claude startup snapshot
- `memory/codex-current.md`: Codex startup snapshot

## Purpose

- Keep new sessions small
- Preserve stable conclusions
- Share project truth without mixing it into long chat transcripts

## Maintenance Rule

When a decision is stable and likely to matter again, summarize it here in a few lines instead of relying on a giant chat transcript.
