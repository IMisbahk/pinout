# Control Journal

The journal is an append-only record of everything the runtime decided and
did (`packages/core/src/journal/journal.ts`). It powers inspection
(`pinout logs`), debugging, regression tests, and replay (`pinout replay`).

## What is recorded

Invocations requested/completed/failed, policy rejections, operation
lifecycle (`operation.*`), state changes, events, faults raised/cleared,
safety state changes, device connect/reconnect, and lease activity.

## Redaction and bounds

- Credential-shaped keys (`password`, `token`, `secret`, `authorization`,
  `api key`, `private key`, …) are replaced with `[REDACTED]` before storage,
  recursively.
- Payloads larger than `maxPayloadChars` (default 4096) are replaced with a
  size marker plus a 512-char preview.
- Arrays are capped at 32 entries.

Secrets and large raw data must never reach the journal.

## Storage

Storage is behind a `JournalStorage` interface. Two implementations ship:
`MemoryJournalStorage` (synchronous, for tests/embedded use) and
`FileJournalStorage` (JSONL, one entry per line, torn-line tolerant). No
cloud database is required or implied; `Journal.hydrate()` resumes sequence
numbering from an existing file after restart.

## Replay

Replay reads entries in sequence order and re-feeds them to consumers —
useful for debugging sessions, demos, module development, and simulation.
The daemon exposes `GET /v1/journal?deviceId=&limit=` for inspection.
