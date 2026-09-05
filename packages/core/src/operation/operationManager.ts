/**
 * Long-running operation lifecycle (spec v1).
 *
 * Physical actions rarely complete in a single round trip. An Operation wraps
 * a deterministic run function with:
 *
 * - explicit status transitions (queued → running → terminal / requires_reconciliation),
 * - an idempotency key so client retries do not duplicate physical side effects,
 * - cooperative cancellation (the run acknowledges; we never lie about it),
 * - distinction between cancel requested, confirmed stop, and unconfirmed stop,
 * - recovery across process crashes (preserving uncertain outcomes and blocking silent replays),
 * - explicit operator reconciliation for uncertain outcomes,
 * - deadlines (timed_out),
 * - progress reporting with per-operation sequence numbers,
 * - AsyncIterable progress streams for SDK consumers.
 *
 * The manager is transport-agnostic and has no dependency on any AI protocol.
 */
import { AbortedError, PinoutStructuredError, toStructuredError } from '../errors.js';
import type {
  OperationProgress,
  OperationSnapshot as SpecOperationSnapshot,
  OperationStatus as SpecOperationStatus,
} from '../spec/types.js';
import { BoundedIdempotencyStore } from './idempotencyStore.js';
import type { IdempotencyTombstone } from './idempotencyStore.js';
import type { Journal } from '../journal/journal.js';

export type ExtendedOperationStatus =
  | SpecOperationStatus
  | 'requires_reconciliation'
  | 'uncertain'
  | 'aborted'
  | 'stop_unconfirmed';

export type OperationStatus = ExtendedOperationStatus;

export type ReconciliationResolution = 'observedComplete' | 'observedNotDone' | 'abandoned';

export interface ReconciliationRecord {
  resolution: ReconciliationResolution;
  note?: string;
  actor?: string;
  reconciledAt: number;
}

export interface ReconcileOptions {
  resolution: ReconciliationResolution;
  note?: string;
  actor?: string;
  result?: Record<string, unknown>;
}

export interface ExtendedOperationSnapshot extends Omit<SpecOperationSnapshot, 'status'> {
  status: OperationStatus;
  reconciled?: boolean;
  reconciliation?: ReconciliationRecord;
}

export type OperationSnapshot = ExtendedOperationSnapshot;

export type { OperationProgress };

const TERMINAL_STATUSES: readonly OperationStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'rejected',
  'requires_reconciliation',
  'uncertain',
  'aborted',
  'stop_unconfirmed',
];

export function isTerminalOperationStatus(status: OperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
}

export class StopUnconfirmedError extends Error {
  readonly code = 'STOP_UNCONFIRMED';
  constructor(message = 'Device failed to confirm physical stop.') {
    super(message);
    this.name = 'StopUnconfirmedError';
  }
}

export interface OperationRunContext {
  /** Abort when cancel() is invoked; the run must acknowledge it. */
  readonly signal: AbortSignal;
  /** Report progress. `fraction` is 0..1 or null for indeterminate work. */
  reportProgress(fraction: number | null, message?: string): void;
  /** True when cancel() has been requested; poll in long loops. */
  readonly cancellationRequested: () => boolean;
  /** Throw AbortedError if cancellation was requested. */
  throwIfCancelled(): void;
}

export interface BeginOperationOptions {
  deviceId: string;
  capability: string;
  /** Lease owner / caller identity; scopes idempotency keys per caller. */
  owner?: string;
  idempotencyKey?: string;
  /** Absolute epoch-ms deadline; the operation becomes `timed_out` past it. */
  deadline?: number;
  /** Milliseconds relative to start; shorthand for `deadline`. */
  timeoutMs?: number;
  /** If false, cancel() on a queued operation rejects it instead of cancelling. */
  cancellable?: boolean;
  /** Minimal test hooks for deterministic crash-window injection without production side-effects. */
  testHooks?: {
    beforeDispatch?: () => Promise<void> | void;
    afterDispatchBeforeAck?: () => Promise<void> | void;
  };
  run(context: OperationRunContext): Promise<Record<string, unknown>>;
}

export interface OperationManagerEvents {
  onOperationEvent?(event: {
    kind:
      | 'operation.requested'
      | 'operation.started'
      | 'operation.progress'
      | 'operation.completed'
      | 'operation.failed'
      | 'operation.cancelled'
      | 'operation.timed_out'
      | 'operation.rejected'
      | 'operation.reconciled'
      | 'operation.uncertain'
      | 'operation.aborted'
      | 'operation.stop_unconfirmed';
    operationId: string;
    deviceId: string;
    capability: string;
    at: number;
    data?: Record<string, unknown>;
  }): void;
}

export interface OperationBeginResult {
  /** True when an existing in-flight or completed operation was returned via idempotency key. */
  deduped: boolean;
  handle: OperationHandle;
}

export interface OperationHandle {
  readonly id: string;
  snapshot(): OperationSnapshot;
  /** Resolves with the result, or throws the failure. Idempotent across callers. */
  waitForResult(): Promise<Record<string, unknown>>;
  /** Request cancellation; resolves with the snapshot once terminal. */
  cancel(reason?: string): Promise<OperationSnapshot>;
  subscribe(listener: (progress: OperationProgress) => void): () => void;
  progress(): AsyncIterable<OperationProgress>;
}

export interface OperationManagerOptions {
  journal?: Journal;
  retentionMs?: number;
  maxOperations?: number;
}

export class OperationManager {
  private readonly operations = new Map<
    string,
    OperationSnapshot & { abort?: AbortController; owner?: string }
  >();
  private readonly waiters = new Map<
    string,
    Array<(err: unknown, result?: Record<string, unknown>) => void>
  >();
  private readonly progressListeners = new Map<
    string,
    Set<(progress: OperationProgress) => void>
  >();
  private readonly events: OperationManagerEvents;
  private sequence = 0;
  private readonly journal: Journal | undefined;
  private readonly retentionMs: number;
  private readonly maxOperations: number;

  readonly idempotencyStore: BoundedIdempotencyStore;

  constructor(
    events: OperationManagerEvents = {},
    idempotencyStore: BoundedIdempotencyStore = new BoundedIdempotencyStore(),
    options: OperationManagerOptions = {},
  ) {
    this.events = events;
    this.idempotencyStore = idempotencyStore;
    this.journal = options.journal;
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    this.maxOperations = options.maxOperations ?? 10_000;
  }

  /**
   * Restore operations and idempotency tombstones from the journal after restart.
   *
   * Crash windows handled deterministically:
   * (a) Crash before dispatch (requested only): marked 'aborted', never auto-replayed.
   * (b) Crash after dispatch, before ack (started only): marked 'requires_reconciliation', blocks silent replay.
   * (c) Crash after completion (completed in journal): restored with recorded result.
   */
  async hydrate(): Promise<void> {
    if (!this.journal) return;
    const entries = await this.journal.query({
      kinds: [
        'operation.requested',
        'operation.started',
        'operation.progress',
        'operation.completed',
        'operation.failed',
        'operation.cancelled',
        'operation.timed_out',
        'operation.rejected',
        'operation.reconciled',
        'operation.uncertain',
        'operation.aborted',
        'operation.stop_unconfirmed',
      ],
    });

    interface OpState {
      operationId: string;
      deviceId: string;
      capability: string;
      owner?: string;
      idempotencyKey?: string;
      createdAt: number;
      startedAt?: number;
      cancelRequestedAt?: number;
      finishedAt?: number;
      progress: OperationProgress | null;
      status: OperationStatus;
      result?: Record<string, unknown>;
      error?: {
        code: string;
        message: string;
        retryable: boolean;
        details?: Record<string, unknown>;
      };
      reconciled?: boolean;
      reconciliation?: ReconciliationRecord;
      hasRequested: boolean;
      hasStarted: boolean;
      hasTerminal: boolean;
    }

    const ops = new Map<string, OpState>();

    for (const entry of entries) {
      if (!entry.operationId || !entry.deviceId) continue;
      const payload = entry.payload ?? {};
      let op = ops.get(entry.operationId);

      if (!op) {
        op = {
          operationId: entry.operationId,
          deviceId: entry.deviceId,
          capability: typeof payload.capability === 'string' ? payload.capability : 'unknown',
          ...(typeof payload.owner === 'string' ? { owner: payload.owner } : {}),
          ...(typeof payload.idempotencyKey === 'string'
            ? { idempotencyKey: payload.idempotencyKey }
            : {}),
          createdAt: entry.at,
          progress: null,
          status: 'queued',
          hasRequested: false,
          hasStarted: false,
          hasTerminal: false,
        };
        ops.set(entry.operationId, op);
      }

      if (typeof payload.capability === 'string') op.capability = payload.capability;
      if (typeof payload.owner === 'string') op.owner = payload.owner;
      if (typeof payload.idempotencyKey === 'string') op.idempotencyKey = payload.idempotencyKey;

      if (entry.kind === 'operation.requested') {
        op.hasRequested = true;
        op.createdAt = entry.at;
        op.status = 'queued';
      } else if (entry.kind === 'operation.started') {
        op.hasStarted = true;
        op.startedAt = entry.at;
        op.status = 'running';
      } else if (entry.kind === 'operation.progress') {
        const frac = typeof payload.fraction === 'number' ? payload.fraction : null;
        const msg = typeof payload.message === 'string' ? payload.message : undefined;
        op.progress = {
          fraction: frac,
          ...(msg !== undefined ? { message: msg } : {}),
          at: entry.at,
        };
      } else if (entry.kind === 'operation.completed') {
        op.hasTerminal = true;
        op.status = 'completed';
        op.finishedAt = entry.at;
        if (payload.result && typeof payload.result === 'object') {
          op.result = payload.result as Record<string, unknown>;
        }
      } else if (entry.kind === 'operation.failed') {
        op.hasTerminal = true;
        op.status = 'failed';
        op.finishedAt = entry.at;
        if (payload.error && typeof payload.error === 'object') {
          const err = payload.error as Record<string, unknown>;
          if (typeof err.code === 'string' && typeof err.message === 'string') {
            op.error = {
              code: err.code,
              message: err.message,
              retryable: typeof err.retryable === 'boolean' ? err.retryable : false,
              ...(err.details && typeof err.details === 'object'
                ? { details: err.details as Record<string, unknown> }
                : {}),
            };
          }
        }
      } else if (entry.kind === 'operation.cancelled') {
        op.hasTerminal = true;
        op.status = 'cancelled';
        op.finishedAt = entry.at;
        op.error = {
          code: 'OPERATION_CANCELLED',
          message: typeof payload.reason === 'string' ? payload.reason : 'Operation cancelled.',
          retryable: true,
        };
      } else if (entry.kind === 'operation.timed_out') {
        op.hasTerminal = true;
        op.status = 'timed_out';
        op.finishedAt = entry.at;
        op.error = {
          code: 'OPERATION_TIMEOUT',
          message: 'Operation exceeded its deadline.',
          retryable: true,
        };
      } else if (entry.kind === 'operation.rejected') {
        op.hasTerminal = true;
        op.status = 'rejected';
        op.finishedAt = entry.at;
      } else if (entry.kind === 'operation.reconciled') {
        op.hasTerminal = true;
        const res = payload.resolution as ReconciliationResolution;
        op.reconciled = true;
        op.reconciliation = {
          resolution: res,
          ...(typeof payload.note === 'string' ? { note: payload.note } : {}),
          ...(typeof payload.actor === 'string' ? { actor: payload.actor } : {}),
          reconciledAt: entry.at,
        };
        op.finishedAt = entry.at;
        if (res === 'observedComplete') {
          op.status = 'completed';
          op.result = (payload.result as Record<string, unknown>) ?? {
            reconciled: true,
            resolution: res,
          };
          delete op.error;
        } else if (res === 'observedNotDone') {
          op.status = 'cancelled';
          op.error = {
            code: 'OPERATION_RECONCILED_NOT_DONE',
            message: 'Reconciled as not done.',
            retryable: false,
          };
        } else {
          op.status = 'failed';
          op.error = {
            code: 'OPERATION_ABANDONED',
            message: 'Operation abandoned during reconciliation.',
            retryable: false,
          };
        }
      } else if (entry.kind === 'operation.aborted') {
        op.hasTerminal = true;
        op.status = 'aborted';
        op.finishedAt = entry.at;
        op.error = {
          code: 'OPERATION_ABORTED_BEFORE_DISPATCH',
          message: 'Operation was accepted but not dispatched before restart.',
          retryable: false,
        };
      } else if (entry.kind === 'operation.stop_unconfirmed') {
        op.hasTerminal = true;
        op.status = 'stop_unconfirmed';
        op.finishedAt = entry.at;
        op.error = {
          code: 'OPERATION_STOP_UNCONFIRMED',
          message: 'Cancellation was requested but device stop was unconfirmed.',
          retryable: false,
        };
      }
    }

    const tombstones: IdempotencyTombstone[] = [];

    for (const op of ops.values()) {
      if (!op.hasTerminal) {
        if (op.hasStarted) {
          // Window B: Dispatched, but no terminal acknowledgment in journal!
          op.status = 'requires_reconciliation';
          op.finishedAt = Date.now();
          op.error = {
            code: 'OPERATION_REQUIRES_RECONCILIATION',
            message:
              'Process restarted while operation was in flight. Physical outcome is uncertain and requires reconciliation.',
            retryable: false,
            details: {
              crashWindow: 'after_dispatch_before_ack',
              ...(op.startedAt !== undefined ? { startedAt: op.startedAt } : {}),
            },
          };
        } else {
          // Window A: Requested/accepted, but not yet dispatched to device!
          op.status = 'aborted';
          op.finishedAt = Date.now();
          op.error = {
            code: 'OPERATION_ABORTED_BEFORE_DISPATCH',
            message: 'Operation was accepted but not dispatched before process restart.',
            retryable: false,
            details: {
              crashWindow: 'before_dispatch',
              createdAt: op.createdAt,
            },
          };
        }
      }

      const snapshot: OperationSnapshot & { owner?: string } = {
        id: op.operationId,
        deviceId: op.deviceId,
        capability: op.capability,
        status: op.status,
        ...(op.idempotencyKey ? { idempotencyKey: op.idempotencyKey } : {}),
        ...(op.owner !== undefined ? { owner: op.owner } : {}),
        createdAt: op.createdAt,
        ...(op.startedAt !== undefined ? { startedAt: op.startedAt } : {}),
        ...(op.cancelRequestedAt !== undefined ? { cancelRequestedAt: op.cancelRequestedAt } : {}),
        ...(op.finishedAt !== undefined ? { finishedAt: op.finishedAt } : {}),
        progress: op.progress,
        ...(op.result !== undefined ? { result: op.result } : {}),
        ...(op.error !== undefined ? { error: op.error } : {}),
        ...(op.reconciled ? { reconciled: true } : {}),
        ...(op.reconciliation ? { reconciliation: op.reconciliation } : {}),
      };

      this.operations.set(op.operationId, snapshot);

      const match = op.operationId.match(/^op_(\d+)_/);
      if (match && match[1]) {
        const seq = Number.parseInt(match[1], 10);
        if (Number.isFinite(seq) && seq > this.sequence) {
          this.sequence = seq;
        }
      }

      if (op.idempotencyKey) {
        tombstones.push({
          operationId: op.operationId,
          deviceId: op.deviceId,
          capability: op.capability,
          owner: op.owner,
          idempotencyKey: op.idempotencyKey,
          status: op.status,
          createdAt: op.createdAt,
          lastUsedAt: op.finishedAt ?? op.createdAt,
          ...(op.result ? { result: op.result } : {}),
          ...(op.error ? { error: op.error } : {}),
        });
      }
    }

    this.idempotencyStore.hydrate(tombstones);
  }

  /**
   * Begin an operation. With an idempotency key, a retry while the original is
   * still active returns the existing handle (`deduped: true`) instead of
   * executing a second time. A completed/failed/uncertain original is returned too,
   * so clients that retry observe the same outcome and non-idempotent actions
   * are never replayed.
   */
  begin(options: BeginOperationOptions): OperationBeginResult {
    if (options.idempotencyKey) {
      const lookup = this.idempotencyStore.lookup(
        options.deviceId,
        options.capability,
        options.owner,
        options.idempotencyKey,
      );
      if (lookup.hit && lookup.operationId && this.operations.has(lookup.operationId)) {
        return { deduped: true, handle: this.getHandle(lookup.operationId) };
      }
      if (lookup.hit && lookup.tombstone) {
        const tombstone = lookup.tombstone;
        const restored: OperationSnapshot & { owner?: string } = {
          id: tombstone.operationId,
          deviceId: tombstone.deviceId,
          capability: tombstone.capability,
          status: tombstone.status as OperationStatus,
          idempotencyKey: tombstone.idempotencyKey,
          ...(tombstone.owner !== undefined ? { owner: tombstone.owner } : {}),
          createdAt: tombstone.createdAt,
          finishedAt: tombstone.lastUsedAt,
          progress: null,
          ...(tombstone.result ? { result: tombstone.result } : {}),
          ...(tombstone.error ? { error: tombstone.error } : {}),
        };
        this.operations.set(restored.id, restored);
        return { deduped: true, handle: this.getHandle(restored.id) };
      }
    }

    const id = `op_${++this.sequence}_${randomId()}`;
    const now = Date.now();
    const deadline =
      options.deadline ?? (options.timeoutMs !== undefined ? now + options.timeoutMs : undefined);

    const snapshot: OperationSnapshot & { abort?: AbortController; owner?: string } = {
      id,
      deviceId: options.deviceId,
      capability: options.capability,
      status: 'queued',
      ...(options.idempotencyKey ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.owner !== undefined ? { owner: options.owner } : {}),
      createdAt: now,
      ...(deadline !== undefined ? { deadline } : {}),
      progress: null,
    };
    this.operations.set(id, snapshot);
    this.emit('operation.requested', id, options.deviceId, options.capability, now, {
      ...(options.idempotencyKey !== undefined ? { idempotencyKey: options.idempotencyKey } : {}),
      ...(options.owner !== undefined ? { owner: options.owner } : {}),
      capability: options.capability,
    });

    if (options.idempotencyKey) {
      this.idempotencyStore.recordUnder(
        BoundedIdempotencyStore.keyFor(
          options.deviceId,
          options.capability,
          options.owner,
          options.idempotencyKey,
        ),
        {
          operationId: id,
          deviceId: options.deviceId,
          capability: options.capability,
          owner: options.owner,
          idempotencyKey: options.idempotencyKey,
          status: 'queued',
          createdAt: now,
        },
      );
    }

    this.start(id, options);
    return { deduped: false, handle: this.getHandle(id) };
  }

  /** Find an operation by id. */
  get(operationId: string): OperationSnapshot | undefined {
    const op = this.operations.get(operationId);
    if (!op) return undefined;
    return this.publicSnapshot(op);
  }

  /** All operations, newest last. */
  list(filter: { deviceId?: string; status?: OperationStatus } = {}): OperationSnapshot[] {
    const out: OperationSnapshot[] = [];
    for (const op of this.operations.values()) {
      if (filter.deviceId && op.deviceId !== filter.deviceId) continue;
      if (filter.status && op.status !== filter.status) continue;
      out.push(this.publicSnapshot(op));
    }
    return out;
  }

  /**
   * Request cancellation. For queued operations this cancels immediately
   * (never executed). For running operations the abort signal fires and the
   * status becomes `cancelled` only once the run acknowledges it.
   */
  cancel(operationId: string, reason?: string): Promise<OperationSnapshot> {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new PinoutStructuredError(
        'OPERATION_NOT_FOUND',
        'OPERATION',
        `Unknown operation '${operationId}'.`,
        {
          operation: operationId,
        },
      );
    }
    if (isTerminalOperationStatus(op.status)) {
      return Promise.resolve(this.publicSnapshot(op));
    }
    if (op.status === 'queued') {
      this.transition(op, 'cancelled', {
        error: {
          code: 'OPERATION_CANCELLED',
          message: reason ?? 'Cancelled before start.',
          retryable: false,
          details: { stopConfirmed: true, queued: true },
        },
      });
      this.emit('operation.cancelled', op.id, op.deviceId, op.capability, Date.now(), {
        ...(reason !== undefined ? { reason } : {}),
        stopConfirmed: true,
      });
      this.settle(op.id);
      return Promise.resolve(this.publicSnapshot(op));
    }
    op.status = 'cancelling';
    op.cancelRequestedAt = Date.now();
    op.abort?.abort(new AbortedError(reason ?? 'Operation cancelled.'));
    return new Promise((resolve) => {
      this.waiters.set(op.id, [
        ...(this.waiters.get(op.id) ?? []),
        () => resolve(this.publicSnapshot(this.operations.get(op.id)!)),
      ]);
    });
  }

  /**
   * Reconcile an uncertain operation outcome (e.g. after a crash or unconfirmed stop).
   */
  async reconcile(operationId: string, options: ReconcileOptions): Promise<OperationSnapshot> {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new PinoutStructuredError(
        'OPERATION_NOT_FOUND',
        'OPERATION',
        `Unknown operation '${operationId}'.`,
        { operation: operationId },
      );
    }
    if (
      op.status !== 'requires_reconciliation' &&
      op.status !== 'uncertain' &&
      op.status !== 'stop_unconfirmed'
    ) {
      throw new PinoutStructuredError(
        'OPERATION_NOT_UNCERTAIN',
        'OPERATION',
        `Operation '${operationId}' is in status '${op.status}' and does not require reconciliation.`,
        { operation: operationId, details: { status: op.status } },
      );
    }

    const now = Date.now();
    op.reconciled = true;
    op.reconciliation = {
      resolution: options.resolution,
      ...(options.note !== undefined ? { note: options.note } : {}),
      ...(options.actor !== undefined ? { actor: options.actor } : {}),
      reconciledAt: now,
    };
    op.finishedAt = now;

    if (options.resolution === 'observedComplete') {
      op.status = 'completed';
      op.result = options.result ?? {
        reconciled: true,
        resolution: 'observedComplete',
        ...(options.note ? { note: options.note } : {}),
      };
      delete op.error;
    } else if (options.resolution === 'observedNotDone') {
      op.status = 'cancelled';
      op.error = {
        code: 'OPERATION_RECONCILED_NOT_DONE',
        message: options.note ?? 'Reconciled as not done by operator.',
        retryable: false,
        details: {
          resolution: 'observedNotDone',
          ...(options.actor ? { actor: options.actor } : {}),
        },
      };
    } else {
      // 'abandoned'
      op.status = 'failed';
      op.error = {
        code: 'OPERATION_ABANDONED',
        message: options.note ?? 'Operation abandoned during reconciliation.',
        retryable: false,
        details: {
          resolution: 'abandoned',
          ...(options.actor ? { actor: options.actor } : {}),
        },
      };
    }

    if (op.idempotencyKey) {
      this.idempotencyStore.updateUnder(
        BoundedIdempotencyStore.keyFor(op.deviceId, op.capability, op.owner, op.idempotencyKey),
        {
          status: op.status,
          ...(op.result ? { result: op.result } : {}),
          ...(op.error ? { error: op.error } : {}),
        },
      );
    }

    this.emit('operation.reconciled', op.id, op.deviceId, op.capability, now, {
      resolution: options.resolution,
      ...(options.note !== undefined ? { note: options.note } : {}),
      ...(options.actor !== undefined ? { actor: options.actor } : {}),
      status: op.status,
      ...(op.result !== undefined ? { result: op.result } : {}),
      ...(op.error !== undefined ? { error: op.error } : {}),
    });

    this.settle(op.id);
    this.retainOperations();
    return this.publicSnapshot(op);
  }

  /** Wait for a terminal state. Resolves with the final snapshot. */
  waitFor(operationId: string): Promise<OperationSnapshot> {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new PinoutStructuredError(
        'OPERATION_NOT_FOUND',
        'OPERATION',
        `Unknown operation '${operationId}'.`,
        {
          operation: operationId,
        },
      );
    }
    if (isTerminalOperationStatus(op.status)) {
      return Promise.resolve(this.publicSnapshot(op));
    }
    return new Promise((resolve) => {
      this.waiters.set(op.id, [
        ...(this.waiters.get(op.id) ?? []),
        () => resolve(this.publicSnapshot(this.operations.get(op.id)!)),
      ]);
    });
  }

  getHandle(operationId: string): OperationHandle {
    const op = this.operations.get(operationId);
    if (!op) {
      throw new PinoutStructuredError(
        'OPERATION_NOT_FOUND',
        'OPERATION',
        `Unknown operation '${operationId}'.`,
        {
          operation: operationId,
        },
      );
    }
    return {
      id: operationId,
      snapshot: () => this.publicSnapshot(this.operations.get(operationId)!),
      waitForResult: () => this.waitForResult(operationId),
      cancel: (reason?: string) => this.cancel(operationId, reason),
      subscribe: (listener) => this.subscribeProgress(operationId, listener),
      progress: () => this.progressIterable(operationId),
    };
  }

  // -------------------------------------------------------------------------

  private start(operationId: string, options: BeginOperationOptions): void {
    const op = this.operations.get(operationId)!;
    const abort = new AbortController();
    op.abort = abort;

    const context: OperationRunContext = {
      signal: abort.signal,
      reportProgress: (fraction, message) => {
        if (isTerminalOperationStatus(op.status)) return;
        if (fraction !== null && (fraction < 0 || fraction > 1 || !Number.isFinite(fraction))) {
          throw new PinoutStructuredError(
            'OPERATION_INVALID_PROGRESS',
            'OPERATION',
            'Progress fraction must be within [0, 1] or null.',
          );
        }
        op.progress = { fraction, ...(message !== undefined ? { message } : {}), at: Date.now() };
        this.emit('operation.progress', op.id, op.deviceId, op.capability, op.progress.at, {
          fraction,
          ...(message !== undefined ? { message } : {}),
        });
        const listeners = this.progressListeners.get(op.id);
        if (listeners) {
          for (const listener of listeners) listener({ ...op.progress });
        }
      },
      cancellationRequested: () => abort.signal.aborted,
      throwIfCancelled: () => {
        if (abort.signal.aborted) throw new AbortedError('Operation cancelled.');
      },
    };

    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    if (op.deadline !== undefined) {
      const remaining = Math.max(0, op.deadline - Date.now());
      deadlineTimer = setTimeout(() => {
        if (!isTerminalOperationStatus(op.status) && op.status === 'running') {
          op.abort?.abort(new AbortedError('Operation timed out.'));
          this.transition(op, 'timed_out', {
            error: {
              code: 'OPERATION_TIMEOUT',
              message: 'Operation exceeded its deadline.',
              retryable: true,
            },
          });
          this.emit('operation.timed_out', op.id, op.deviceId, op.capability, Date.now(), {
            error: op.error,
          });
          this.settle(op.id);
        }
      }, remaining);
      if (typeof deadlineTimer === 'object' && deadlineTimer !== null && 'unref' in deadlineTimer) {
        deadlineTimer.unref();
      }
    }

    queueMicrotask(async () => {
      if (isTerminalOperationStatus(op.status)) {
        clearTimeout(deadlineTimer);
        return;
      }
      try {
        await options.testHooks?.beforeDispatch?.();
      } catch (err) {
        clearTimeout(deadlineTimer);
        this.transition(op, 'aborted', {
          error: {
            code: 'OPERATION_ABORTED_BEFORE_DISPATCH',
            message: err instanceof Error ? err.message : String(err),
            retryable: false,
          },
        });
        this.emit('operation.aborted', op.id, op.deviceId, op.capability, Date.now());
        this.settle(op.id);
        return;
      }

      op.status = 'running';
      op.startedAt = Date.now();
      this.emit('operation.started', op.id, op.deviceId, op.capability, op.startedAt);

      try {
        const result = await options.run(context);
        if (isTerminalOperationStatus(op.status)) return;

        try {
          await options.testHooks?.afterDispatchBeforeAck?.();
        } catch (err) {
          clearTimeout(deadlineTimer);
          this.transition(op, 'requires_reconciliation', {
            error: {
              code: 'OPERATION_REQUIRES_RECONCILIATION',
              message: err instanceof Error ? err.message : String(err),
              retryable: false,
            },
          });
          this.emit('operation.uncertain', op.id, op.deviceId, op.capability, Date.now());
          this.settle(op.id);
          return;
        }

        // If the run finished despite a cancel request, report completed honestly.
        this.transition(op, 'completed', { result });
        this.emit('operation.completed', op.id, op.deviceId, op.capability, Date.now(), { result });
        this.settle(op.id);
      } catch (error) {
        clearTimeout(deadlineTimer);
        if (isTerminalOperationStatus(op.status)) return;

        if (abort.signal.aborted) {
          const isStopUnconfirmed =
            error instanceof StopUnconfirmedError ||
            (error instanceof Error && error.name === 'StopUnconfirmedError') ||
            (typeof error === 'object' &&
              error !== null &&
              'code' in error &&
              error.code === 'STOP_UNCONFIRMED');

          if (isStopUnconfirmed) {
            this.transition(op, 'stop_unconfirmed', {
              error: {
                code: 'OPERATION_STOP_UNCONFIRMED',
                message:
                  error instanceof Error
                    ? error.message
                    : 'Cancellation requested but device failed to confirm stop.',
                retryable: false,
                details: { stopConfirmed: false },
              },
            });
            this.emit(
              'operation.stop_unconfirmed',
              op.id,
              op.deviceId,
              op.capability,
              Date.now(),
              {
                reason: String(error instanceof Error ? error.message : error),
                error: op.error,
              },
            );
          } else if (error instanceof AbortedError || isAbortError(error)) {
            this.transition(op, 'cancelled', {
              error: {
                code: 'OPERATION_CANCELLED',
                message: 'Operation cancelled.',
                retryable: true,
                details: { stopConfirmed: true },
              },
            });
            this.emit('operation.cancelled', op.id, op.deviceId, op.capability, Date.now(), {
              reason: String(error instanceof Error ? error.message : error),
              error: op.error,
            });
          } else {
            const structured = toStructuredError(error, {
              device: op.deviceId,
              capability: op.capability,
              operation: op.id,
            });
            this.transition(op, 'stop_unconfirmed', {
              error: {
                code: 'OPERATION_STOP_UNCONFIRMED',
                message: `Cancellation requested but device failed: ${structured.message}`,
                retryable: false,
                details: { stopConfirmed: false, cause: structured },
              },
            });
            this.emit(
              'operation.stop_unconfirmed',
              op.id,
              op.deviceId,
              op.capability,
              Date.now(),
              {
                code: 'OPERATION_STOP_UNCONFIRMED',
                error: op.error,
              },
            );
          }
        } else {
          const structured = toStructuredError(error, {
            device: op.deviceId,
            capability: op.capability,
            operation: op.id,
          });
          this.transition(op, 'failed', {
            error: {
              code: structured.code,
              message: structured.message,
              retryable: structured.retryable,
              ...(Object.keys(structured.details ?? {}).length > 0
                ? { details: structured.details }
                : {}),
            },
          });
          this.emit('operation.failed', op.id, op.deviceId, op.capability, Date.now(), {
            code: structured.code,
            error: op.error,
          });
        }
        this.settle(op.id);
      } finally {
        clearTimeout(deadlineTimer);
      }
    });
  }

  private transition(
    op: OperationSnapshot & { abort?: AbortController; owner?: string },
    status: OperationStatus,
    extra: {
      result?: Record<string, unknown>;
      error?: {
        code: string;
        message: string;
        retryable: boolean;
        details?: Record<string, unknown>;
      };
    },
  ): void {
    op.status = status;
    op.finishedAt = Date.now();
    if (extra.result) op.result = extra.result;
    if (extra.error) op.error = extra.error;
    if (op.idempotencyKey) {
      this.idempotencyStore.updateUnder(
        BoundedIdempotencyStore.keyFor(op.deviceId, op.capability, op.owner, op.idempotencyKey),
        {
          status,
          ...(extra.result ? { result: extra.result } : {}),
          ...(extra.error ? { error: extra.error } : {}),
        },
      );
    }
    this.retainOperations();
  }

  /** Notify waiters once terminal. */
  private settle(operationId: string): void {
    const op = this.operations.get(operationId)!;
    if (!isTerminalOperationStatus(op.status)) return;
    const waiters = this.waiters.get(operationId) ?? [];
    this.waiters.delete(operationId);
    const failed = op.status !== 'completed';
    const err = failed ? new Error(op.error?.message ?? op.status) : undefined;
    for (const waiter of waiters) waiter(err, op.result);
  }

  private waitForResult(operationId: string): Promise<Record<string, unknown>> {
    const op = this.operations.get(operationId)!;
    return new Promise((resolve, reject) => {
      const deliver = (snapshot: OperationSnapshot): void => {
        if (snapshot.status === 'completed') {
          resolve(snapshot.result ?? {});
        } else if (
          snapshot.status === 'requires_reconciliation' ||
          snapshot.status === 'uncertain'
        ) {
          reject(
            new PinoutStructuredError(
              'OPERATION_REQUIRES_RECONCILIATION',
              'OPERATION',
              snapshot.error?.message ??
                'Operation outcome is uncertain and requires reconciliation.',
              {
                operation: operationId,
                device: snapshot.deviceId,
                capability: snapshot.capability,
                ...(snapshot.error?.details ? { details: snapshot.error.details } : {}),
                retryable: false,
              },
            ),
          );
        } else if (snapshot.status === 'aborted') {
          reject(
            new PinoutStructuredError(
              snapshot.error?.code ?? 'OPERATION_ABORTED',
              'OPERATION',
              snapshot.error?.message ?? 'Operation was aborted before dispatch.',
              {
                operation: operationId,
                device: snapshot.deviceId,
                capability: snapshot.capability,
                ...(snapshot.error?.details ? { details: snapshot.error.details } : {}),
                retryable: false,
              },
            ),
          );
        } else if (snapshot.status === 'stop_unconfirmed') {
          reject(
            new PinoutStructuredError(
              'OPERATION_STOP_UNCONFIRMED',
              'OPERATION',
              snapshot.error?.message ?? 'Cancellation requested but device stop was unconfirmed.',
              {
                operation: operationId,
                device: snapshot.deviceId,
                capability: snapshot.capability,
                ...(snapshot.error?.details ? { details: snapshot.error.details } : {}),
                retryable: false,
              },
            ),
          );
        } else if (snapshot.status === 'failed') {
          reject(
            new PinoutStructuredError(
              snapshot.error?.code ?? 'OPERATION_FAILED',
              'OPERATION',
              snapshot.error?.message ?? 'Operation failed.',
              {
                operation: operationId,
                device: snapshot.deviceId,
                capability: snapshot.capability,
                ...(snapshot.error?.details ? { details: snapshot.error.details } : {}),
                ...(snapshot.error?.retryable !== undefined
                  ? { retryable: snapshot.error.retryable }
                  : {}),
              },
            ),
          );
        } else if (snapshot.status === 'cancelled') {
          reject(new AbortedError(snapshot.error?.message ?? 'Operation cancelled.'));
        } else if (snapshot.status === 'timed_out') {
          reject(
            new PinoutStructuredError(
              'OPERATION_TIMEOUT',
              'TIMEOUT',
              snapshot.error?.message ?? 'Operation exceeded its deadline.',
              {
                operation: operationId,
                retryable: true,
              },
            ),
          );
        } else {
          reject(
            new PinoutStructuredError(
              'OPERATION_REJECTED',
              'OPERATION',
              snapshot.error?.message ?? 'Operation was rejected before start.',
              {
                operation: operationId,
              },
            ),
          );
        }
      };
      if (isTerminalOperationStatus(op.status)) {
        deliver(this.publicSnapshot(op));
        return;
      }
      this.waiters.set(operationId, [
        ...(this.waiters.get(operationId) ?? []),
        () => deliver(this.publicSnapshot(this.operations.get(operationId)!)),
      ]);
    });
  }

  subscribeProgress(
    operationId: string,
    listener: (progress: OperationProgress) => void,
  ): () => void {
    let set = this.progressListeners.get(operationId);
    if (!set) {
      set = new Set();
      this.progressListeners.set(operationId, set);
    }
    set.add(listener);
    return () => {
      set.delete(listener);
      if (set.size === 0) this.progressListeners.delete(operationId);
    };
  }

  progressIterable(operationId: string): AsyncIterable<OperationProgress> {
    const queue: OperationProgress[] = [];
    let notify: (() => void) | undefined;
    let done = false;
    const unsubscribe = this.subscribeProgress(operationId, (progress) => {
      queue.push(progress);
      notify?.();
    });
    this.waitFor(operationId)
      .catch(() => undefined)
      .finally(() => {
        done = true;
        notify?.();
      });
    return {
      [Symbol.asyncIterator]() {
        return {
          next(): Promise<IteratorResult<OperationProgress>> {
            if (queue.length > 0) {
              return Promise.resolve({ done: false, value: queue.shift()! });
            }
            if (done) return Promise.resolve({ done: true, value: undefined as never });
            return new Promise<IteratorResult<OperationProgress>>((resolve) => {
              notify = () => {
                notify = undefined;
                if (queue.length > 0) resolve({ done: false, value: queue.shift()! });
                else if (done) resolve({ done: true, value: undefined as never });
              };
            });
          },
          return(): Promise<IteratorResult<OperationProgress>> {
            unsubscribe();
            done = true;
            return Promise.resolve({ done: true, value: undefined as never });
          },
        };
      },
    };
  }

  private emit(
    kind: Parameters<NonNullable<OperationManagerEvents['onOperationEvent']>>[0]['kind'],
    operationId: string,
    deviceId: string,
    capability: string,
    at: number,
    data?: Record<string, unknown>,
  ): void {
    const event = {
      kind,
      operationId,
      deviceId,
      capability,
      at,
      ...(data ? { data } : {}),
    } as const;
    this.events.onOperationEvent?.(event);
    this.journal?.append(kind, { deviceId, operationId }, data ?? {});
  }

  private retainOperations(): void {
    const now = Date.now();
    for (const [id, op] of this.operations) {
      if (
        isTerminalOperationStatus(op.status) &&
        op.finishedAt !== undefined &&
        now - op.finishedAt > this.retentionMs
      ) {
        this.operations.delete(id);
      }
    }
    while (this.operations.size > this.maxOperations) {
      const oldest = this.operations.keys().next().value;
      if (oldest === undefined) break;
      const op = this.operations.get(oldest);
      if (op && !isTerminalOperationStatus(op.status)) break;
      this.operations.delete(oldest);
    }
  }

  private publicSnapshot(
    op: OperationSnapshot & { abort?: AbortController; owner?: string },
  ): OperationSnapshot {
    const { abort: _abort, ...rest } = op;
    return { ...rest };
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && error.name === 'AbortError';
}
