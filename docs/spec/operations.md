# Operations

Physical actions rarely complete in one round trip. Pinout treats them as
first-class **operations** with an explicit lifecycle
(`packages/core/src/operation/operationManager.ts`).

## Statuses

```
queued → running → completed
                 → failed
                 → cancelled   (run acknowledged cancellation)
                 → timed_out   (deadline elapsed)
queued → cancelled             (cancelled before start)
rejected                       (pre-execution rejection)
```

Terminal states: `completed`, `failed`, `cancelled`, `timed_out`, `rejected`.

## Semantics

- **Idempotency keys.** A retried request with the same
  `deviceId + capability + idempotencyKey` returns the original operation —
  forever, not just while it runs. A client that retries after a network
  failure can never re-trigger a physical side effect.
- **Deadlines.** `timeoutMs` or absolute `deadline`; elapsing produces
  `timed_out` with a retryable `OPERATION_TIMEOUT` error.
- **Cancellation is cooperative and honest.** `cancel()` fires the run's
  abort signal; status becomes `cancelled` only when the run acknowledges it.
  A run that finishes despite a cancel request reports `completed` — Pinout
  never lies about what happened to the physical world.
- **Progress.** `reportProgress(fraction | null, message?)` — `null` for
  indeterminate work; fractions outside [0, 1] are rejected. Progress reaches
  subscribers via callbacks and `AsyncIterable` streams with per-operation
  snapshots.
- **Audit.** Every transition emits a journalable event
  (`operation.requested/started/progress/completed/failed/cancelled/timed_out/rejected`).

## Agent ergonomics

An agent can start motion, stream progress, and safely cancel:

```ts
const { handle } = operations.begin({
  deviceId: 'arm-01',
  capability: 'motion.move_to',
  idempotencyKey: requestId,
  timeoutMs: 30_000,
  run: async (ctx) => {
    ctx.throwIfCancelled();
    const result = await arm.moveTo(args, ctx.signal);
    ctx.reportProgress(1);
    return result;
  },
});

for await (const progress of handle.progress()) { /* ... */ }
await handle.waitForResult();
```

## Dry-run

`invoke(..., { dryRun: true })` runs the full resolution, validation, and
policy pass and returns what *would* happen — without any physical side
effect. Dry-run is allowed while the runtime is halted: planning is safe;
execution is not.
