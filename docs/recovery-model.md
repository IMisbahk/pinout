# Recovery, Ownership, and Halt Guarantees Model

This document outlines the state machine, recovery guarantees, ownership rules, and safety halt semantics in Pinout.

Software cannot guarantee physical safety or exactly-once physical side effects in the presence of uncoordinated power loss or system crashes. Pinout's recovery model ensures that physical ambiguity is never masked: uncertain physical outcomes remain explicitly visible, non-idempotent actions are never replayed automatically, and competing owners cannot actuate leased resources.

---

## 1. Architectural Audit

### 1.1 Operation Lifecycle and Persistence

- **Persistence Layer**: Journal storage is abstracted via `JournalStorage` (`packages/core/src/journal/journal.ts:86-90`), with two primary implementations:
  - `MemoryJournalStorage` (`packages/core/src/journal/journal.ts:186-196`): volatile in-memory storage used for testing and ephemeral single-process runs.
  - `FileJournalStorage` (`packages/core/src/journal/journal.ts:198-230`): append-only JSONL file storage on disk, configured via `--journal <path>` or `config.journalPath` in `pinoutd` (`packages/daemon/src/httpServer.ts:114-116`).
- **Journal Sequencing & Appends**:
  - `operation.requested`: Appended synchronously during `OperationManager.begin()` before the async execution microtask is scheduled (`packages/core/src/operation/operationManager.ts:248-252`).
  - `operation.started`: Appended at dispatch immediately when the execution microtask starts and before `run()` invokes the device backend (`packages/core/src/operation/operationManager.ts:451`).
  - `operation.progress`: Appended whenever `reportProgress(fraction, message)` is called by the execution context (`packages/core/src/operation/operationManager.ts:407-409`).
  - `operation.completed`: Appended after the backend `run()` promise resolves successfully with output data (`packages/core/src/operation/operationManager.ts:457`).
  - `operation.failed`: Appended if the backend `run()` promise rejects with an error (`packages/core/src/operation/operationManager.ts:490`).
  - `operation.cancelled`: Appended if the operation is cancelled in queue (`packages/core/src/operation/operationManager.ts:323`) or acknowledged by the backend abort signal (`packages/core/src/operation/operationManager.ts:470`).
  - `operation.timed_out`: Appended if the execution exceeds its deadline timer (`packages/core/src/operation/operationManager.ts:433`).
  - `operation.reconciled`: Appended when an operator or client explicitly reconciles an uncertain operation outcome.

### 1.2 In-Flight Operations on Daemon Restart

Prior to the Phase 4 recovery hardening:
- `OperationManager.hydrate()` (`packages/core/src/operation/operationManager.ts:133-186`) read journal entries into `BoundedIdempotencyStore`, but only stored tombstones in memory without populating the active operations map (`this.operations`).
- If a crash occurred while an operation was in flight:
  1. `operation.requested` was recorded, but no terminal entry existed.
  2. The hydrated tombstone retained `status: 'queued'`.
  3. Because `'queued'` is not a terminal status, a retry with the same idempotency key was not recognized as complete or handled, causing `begin()` to execute a fresh run.
  4. This created a physical safety hazard where dispatched actuation could be silently re-executed without verifying the physical device state.

Under the hardened recovery model:
- `hydrate()` restores operation snapshots directly into `OperationManager.operations` and determines the recovery state based on the exact crash window.
- In-flight operations dispatched to the device but not acknowledged before a crash transition to `requires_reconciliation` (`uncertain`), blocking silent replay and requiring explicit operator resolution.

### 1.3 Idempotency Key Storage and Scoping

- **Scoping**: Keys are scoped using a compound tuple `[deviceId, capability, owner, idempotencyKey]` via `BoundedIdempotencyStore.keyFor()` (`packages/core/src/operation/idempotencyStore.ts:70-76`). This prevents cross-caller and cross-device key collisions.
- **Eviction & Retention**: The store enforces bounded memory with LRU eviction (`maxEntries`, default 10,000) and TTL retention (`retentionMs`, default 24 hours) (`packages/core/src/operation/idempotencyStore.ts:54-61`).
- **Post-Eviction Semantics**: If a key tombstone is evicted due to capacity or age, a subsequent request with that key is treated as fresh. This is an explicit, bounded-guarantee trade-off.

### 1.4 Lease Ownership, Expiry, and Restart Behavior

- **Storage**: Leases are tracked by `LeaseManager` (`packages/core/src/lease/leaseManager.ts:40-44`) in an in-memory map.
- **Conflict Prevention**: `acquire()` (`packages/core/src/lease/leaseManager.ts:50-86`) verifies that no overlapping exclusive lease exists on the requested device or capability.
- **TTL Expiry**: Leases have an explicit TTL (`expiresAt`). Expired leases are reaped on contact and do not permit actuation (`packages/core/src/lease/leaseManager.ts:161-192`).
- **Restart Isolation**: On daemon restart, in-memory leases are cleared. Stale client sessions holding previous lease IDs cannot resume actuation until they explicitly acquire a fresh lease from the active daemon.

### 1.5 Cancellation vs. Confirmed Stop

- **Cancellation Request**: When a client calls `cancel(operationId)` (`packages/core/src/operation/operationManager.ts:300-337`), the operation enters `cancelling`, sets `cancelRequestedAt`, and signals `AbortSignal` to the backend.
- **Confirmed Stop**: If the backend acknowledges the cancellation signal and stops safely, the operation transitions to `cancelled` (`stopped`).
- **Unconfirmed Stop**: If the backend fails to acknowledge cancellation, times out, or disconnects before confirming that physical motion has ceased, the operation transitions to `stop_unconfirmed` or `requires_reconciliation`, preserving the ambiguity.

---

## 2. Operation State Machine

```text
               ┌───────────────────────┐
               │        queued         │
               └──────────┬────────────┘
                          │
            ┌─────────────┴─────────────┐
            │ (dispatch / run context)   │
            ▼                           ▼
 ┌──────────────────────┐    ┌──────────────────────┐
 │       running        │    │       aborted        │ (crash before dispatch)
 └──────────┬───────────┘    └──────────────────────┘
            │
 ┌──────────┼────────────────────────┬─────────────────────────┐
 │ (ack ok) │ (error)                │ (cancel requested)      │ (crash after dispatch)
 ▼          ▼                        ▼                         ▼
┌─────────┐┌────────┐      ┌──────────────────┐      ┌─────────────────────────┐
│completed││ failed │      │    cancelling    │      │  requires_reconciliation│
└─────────┘└────────┘      └─────────┬────────┘      └────────────┬────────────┘
                                     │                            │
                     ┌───────────────┴───────────────┐            │ (reconcile API)
                     │ (device ack)   │ (unconfirmed)│            ▼
                     ▼                ▼              │      ┌───────────┐
               ┌───────────┐   ┌──────────────────┐  └─────►│reconciled │
               │ cancelled │   │ stop_unconfirmed │         └───────────┘
               │ (stopped) │   └──────────────────┘
               └───────────┘
```

---

## 3. Crash Windows and Recovery Guarantees

When the runtime or daemon restarts against an existing persistent journal, operations are categorized into three distinct crash windows:

### Window A: Crash Before Dispatch
- **Pre-condition**: Journal contains `operation.requested`, but does NOT contain `operation.started`.
- **Physical Reality**: The operation was accepted and validated by the control plane, but no command bytes were transmitted to the device backend.
- **Recovery Outcome**: Status is marked as `aborted` / `cancelled` with reason `aborted_before_dispatch`.
- **Guarantee**: Non-idempotent operations are never automatically replayed. If the client retries with the same idempotency key, it receives the aborted status and can safely initiate a new attempt.

### Window B: Crash After Dispatch, Before Acknowledgment
- **Pre-condition**: Journal contains `operation.started`, but does NOT contain `operation.completed`, `operation.failed`, or other terminal events.
- **Physical Reality**: The command was sent to the device. Physical actuation may have fully executed, partially executed, or failed mid-flight. The host process died before receiving or writing the confirmation.
- **Recovery Outcome**: Status is marked as `requires_reconciliation` (or `uncertain`).
- **Guarantee**:
  - The operation is prominently surfaced in `GET /v1/operations` and `GET /v1/operations/:id` with `status: 'requires_reconciliation'`.
  - Retrying with the same idempotency key is **blocked** and returns `OPERATION_REQUIRES_RECONCILIATION`.
  - Silent automatic replay is strictly prohibited to prevent damaging physical machinery.

### Window C: Crash After Completion, Before Client Delivery
- **Pre-condition**: Journal contains `operation.completed` (or `operation.failed`) with the final result payload, but the host crashed before returning the HTTP response to the client.
- **Physical Reality**: Physical action completed and was safely recorded.
- **Recovery Outcome**: Status is restored as `completed` (or `failed`) with the original `result` and `finishedAt` timestamp intact.
- **Guarantee**: The client can query `GET /v1/operations/:id` or retry `POST /v1/devices/:id/invoke` with the same idempotency key to retrieve the exact original result without re-executing physical effects.

---

## 4. Reconciliation Flow for Uncertain Operations

To resolve an operation in `requires_reconciliation`, an operator or autonomous agent must inspect the physical device state and provide an explicit reconciliation verdict.

### 4.1 Reconciliation API

```http
POST /v1/operations/:id/reconcile
Content-Type: application/json

{
  "resolution": "observedComplete", // "observedComplete" | "observedNotDone" | "abandoned"
  "note": "Visual inspection confirmed valve closed at 10:14:02",
  "actor": "operator-alice"
}
```

### 4.2 Resolutions

1. `observedComplete`:
   - Operator or external sensor confirmed the physical action succeeded.
   - Snapshot transitions to terminal status `completed` (or `reconciled`) with `{ reconciled: true, resolution: 'observedComplete' }`.
   - Subsequent retries with the idempotency key observe completion without re-actuation.

2. `observedNotDone`:
   - Operator confirmed the physical action never took place or was completely rolled back.
   - Snapshot transitions to `failed` / `cancelled` with `{ reconciled: true, resolution: 'observedNotDone' }`.
   - The idempotency lock is cleared or updated to allow safe re-execution.

3. `abandoned`:
   - The state is indeterminate or superseded by manual intervention.
   - Snapshot transitions to `failed` with code `OPERATION_ABANDONED`.

---

## 5. What Is and Is Not Guaranteed

### What IS Guaranteed (Software Controls)
1. **No Silent Replay**: Non-idempotent physical commands are never automatically replayed across restarts or crashes.
2. **Deterministic Mutual Exclusion**: Competing owners cannot concurrently actuate the same leased resource.
3. **Lease Invalidation Across Restarts**: Volatile leases are invalidated on daemon restart; stale sessions cannot resume actuation without re-acquiring ownership.
4. **Visibility of Physical Ambiguity**: If a crash occurs during actuation, the operation remains in an explicit `requires_reconciliation` state until acknowledged.
5. **Deterministic Audit Log**: Every state change, safety halt, lease grant, and operation phase is recorded to the append-only journal.

### What is NOT Guaranteed (Physical Realities)
1. **NOT Exactly-Once Physical Actuation**: Software cannot guarantee that a motor did not move if power was cut mid-command.
2. **NOT Certified Hardware Emergency Stop**: Software halt and E-stop routes coordinate software-level rejection; they do not replace electrical safety relays, physical E-stop switches, or interlock hardware.
3. **NOT Indefinite Idempotency**: Idempotency keys are retained within the configured retention window (default 24h) and capacity limits; evicted keys are treated as fresh.
