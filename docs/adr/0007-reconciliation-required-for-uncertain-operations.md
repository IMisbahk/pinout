# ADR 0007: Mandatory reconciliation for uncertain operations across crash windows

Status: Accepted

## Context

Physical hardware actions (moving a robotic arm, opening a solenoid valve, brewing espresso, driving a motor) are fundamentally distinct from pure software transactions. If a process crash, power interruption, or network disconnect occurs while a physical action is in flight, software cannot guarantee whether the command was executed by the microcontroller/actuator before the crash.

Blindly replaying in-flight non-idempotent actions on restart risks causing physical damage (e.g. over-driving a lead screw, opening an already-opened valve, dispensing duplicate chemicals). Conversely, pretending the action never started or pretending it succeeded silently masks physical reality.

## Decision

1. **Deterministic Crash-Window Classification**:
   On daemon/runtime hydration from the append-only control journal, in-flight operations are classified into three explicit recovery windows:
   - **Window A (Crash Before Dispatch)**: Journal contains `operation.requested` but no `operation.started`. The operation never reached the device backend. Hydration marks it as `aborted` with error `OPERATION_ABORTED_BEFORE_DISPATCH`. It is never automatically replayed.
   - **Window B (Crash After Dispatch, Before Acknowledgment)**: Journal contains `operation.started` but no terminal acknowledgment (`completed`, `failed`, `cancelled`, `timed_out`). Hydration marks it as `requires_reconciliation`. Silent retries are strictly blocked and return `OPERATION_REQUIRES_RECONCILIATION`.
   - **Window C (Crash After Completion, Before Client Receipt)**: Journal contains `operation.completed` or `operation.failed` with the final result payload. Hydration restores the completed snapshot and result intact, allowing clients to retrieve the recorded outcome without re-execution.

2. **Explicit Operator Reconciliation**:
   Operations in `requires_reconciliation` (or `stop_unconfirmed`) require explicit resolution via `POST /v1/operations/:id/reconcile` (or SDK `reconcile()`) with one of three explicit verdicts:
   - `observedComplete`: Physical outcome confirmed successful by visual/sensor inspection. Transitions snapshot to `completed` and records verification metadata.
   - `observedNotDone`: Physical action confirmed to have never occurred or safely rolled back. Transitions snapshot to `cancelled` with error `OPERATION_RECONCILED_NOT_DONE`.
   - `abandoned`: Action state is indeterminate or superseded. Transitions snapshot to `failed` with code `OPERATION_ABANDONED`.

3. **Distinction Between Cancellation Requested, Confirmed Stop, and Unconfirmed Stop**:
   - `cancelRequested`: Client requested cooperative cancellation; status is `cancelling` with `cancelRequestedAt` recorded.
   - `stopped` (`cancelled`): Device backend received the abort signal and confirmed physical motion stopped (`stopConfirmed: true`).
   - `stop_unconfirmed`: Device backend threw an error, timed out, or disconnected during cancellation without confirming physical rest (`stopConfirmed: false`), requiring inspection or reconciliation.

4. **Volatile Leases and Restart Invalidation**:
   Resource leases are maintained in volatile daemon memory and invalidated across daemon restarts. Stale client sessions cannot resume actuation under a prior lease ID without explicitly acquiring a fresh lease.

## Consequences

- No silent duplicate actuations occur across daemon restarts or crashes.
- Ambiguous physical states are prominently surfaced to agents and human operators.
- The system never pretends to offer "exactly-once" physical actuation in hardware, upholding honest safety and reliability guarantees.
