/**
 * Long-running operation lifecycle (spec v1).
 *
 * Physical actions rarely complete in a single round trip. An Operation wraps
 * a deterministic run function with:
 *
 * - explicit status transitions (queued → running → terminal),
 * - an idempotency key so client retries do not duplicate physical side effects,
 * - cooperative cancellation (the run acknowledges; we never lie about it),
 * - deadlines (timed_out),
 * - progress reporting with per-operation sequence numbers,
 * - AsyncIterable progress streams for SDK consumers.
 *
 * The manager is transport-agnostic and has no dependency on any AI protocol.
 */
import { AbortedError, PinoutStructuredError, toStructuredError } from '../errors.js';
import type { OperationProgress, OperationSnapshot, OperationStatus } from '../spec/types.js';
import { BoundedIdempotencyStore } from './idempotencyStore.js';

export type { OperationSnapshot, OperationStatus, OperationProgress };

const TERMINAL_STATUSES: readonly OperationStatus[] = [
  'completed',
  'failed',
  'cancelled',
  'timed_out',
  'rejected',
];

export function isTerminalOperationStatus(status: OperationStatus): boolean {
  return TERMINAL_STATUSES.includes(status);
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
      | 'operation.rejected';
    operationId: string;
    deviceId: string;
    capability: string;
    at: number;
    data?: Record<string, unknown>;
  }): void;
}

export interface OperationBeginResult {
  /** True when an existing in-flight operation was returned via idempotency key. */
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

export class OperationManager {
  private readonly operations = new Map<string, OperationSnapshot & { abort?: AbortController; owner?: string }>();
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

  readonly idempotencyStore: BoundedIdempotencyStore;

  constructor(
    events: OperationManagerEvents = {},
    idempotencyStore: BoundedIdempotencyStore = new BoundedIdempotencyStore(),
  ) {
    this.events = events;
    this.idempotencyStore = idempotencyStore;
  }

  /**
   * Begin an operation. With an idempotency key, a retry while the original is
   * still active returns the existing handle (`deduped: true`) instead of
   * executing a second time. A completed/failed original is returned too, so
   * clients that retry forever observe the same outcome.
   */
  begin(options: BeginOperationOptions): OperationBeginResult {
    if (options.idempotencyKey) {
      const scopedKey = BoundedIdempotencyStore.keyFor(
        options.deviceId,
        options.capability,
        options.owner,
        options.idempotencyKey,
      );
      const lookup = this.idempotencyStore.lookup(options.deviceId, options.capability, options.owner, options.idempotencyKey);
      if (lookup.hit && lookup.operationId && this.operations.has(lookup.operationId)) {
        // Within the retention window the key resolves to the original
        // outcome, so a client retry can never re-trigger the side effect.
        return { deduped: true, handle: this.getHandle(lookup.operationId) };
      }
      void scopedKey;
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
    this.emit('operation.requested', id, options.deviceId, options.capability, now);

    if (options.idempotencyKey) {
      this.idempotencyStore.recordUnder(
        BoundedIdempotencyStore.keyFor(options.deviceId, options.capability, options.owner, options.idempotencyKey),
        {
          operationId: id,
          deviceId: options.deviceId,
          capability: options.capability,
          owner: options.owner,
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
        },
      });
      this.emit('operation.cancelled', op.id, op.deviceId, op.capability, Date.now(), { reason });
      return Promise.resolve(this.publicSnapshot(op));
    }
    op.abort?.abort(new AbortedError(reason ?? 'Operation cancelled.'));
    return new Promise((resolve) => {
      this.waiters.set(op.id, [
        ...(this.waiters.get(op.id) ?? []),
        () => resolve(this.publicSnapshot(this.operations.get(op.id)!)),
      ]);
    });
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
          message,
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

    // Deadlines fire independent of the run's cooperation.
    let deadlineTimer: ReturnType<typeof setTimeout> | undefined;
    if (op.deadline !== undefined) {
      const remaining = Math.max(0, op.deadline - Date.now());
      deadlineTimer = setTimeout(() => {
        if (!isTerminalOperationStatus(op.status) && op.status === 'running') {
          this.transition(op, 'timed_out', {
            error: {
              code: 'OPERATION_TIMEOUT',
              message: 'Operation exceeded its deadline.',
              retryable: true,
            },
          });
          this.emit('operation.timed_out', op.id, op.deviceId, op.capability, Date.now());
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
      op.status = 'running';
      op.startedAt = Date.now();
      this.emit('operation.started', op.id, op.deviceId, op.capability, op.startedAt);
      try {
        const result = await options.run(context);
        // If the run finished despite a cancel request, report completed honestly.
        this.transition(op, 'completed', { result });
        this.emit('operation.completed', op.id, op.deviceId, op.capability, Date.now());
        this.settle(op.id);
      } catch (error) {
        clearTimeout(deadlineTimer);
        if (abort.signal.aborted && (error instanceof AbortedError || isAbortError(error))) {
          this.transition(op, 'cancelled', {
            error: {
              code: 'OPERATION_CANCELLED',
              message: 'Operation cancelled.',
              retryable: true,
            },
          });
          this.emit('operation.cancelled', op.id, op.deviceId, op.capability, Date.now(), {
            reason: String(error instanceof Error ? error.message : error),
          });
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
  }

  /** Notify waiters once terminal. */
  private settle(operationId: string): void {
    const op = this.operations.get(operationId)!;
    if (!isTerminalOperationStatus(op.status)) return;
    const waiters = this.waiters.get(operationId) ?? [];
    this.waiters.delete(operationId);
    const failed = op.status !== 'completed';
    const err = failed ? new Error(op.error?.message ?? op.status) : undefined;
    for (const waiter of waiters) waiter(err);
  }

  private waitForResult(operationId: string): Promise<Record<string, unknown>> {
    const op = this.operations.get(operationId)!;
    return new Promise((resolve, reject) => {
      const deliver = (snapshot: OperationSnapshot): void => {
        if (snapshot.status === 'completed') resolve(snapshot.result ?? {});
        else if (snapshot.status === 'failed') {
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
          reject(new AbortedError('Operation cancelled.'));
        } else if (snapshot.status === 'timed_out') {
          reject(
            new PinoutStructuredError(
              'OPERATION_TIMEOUT',
              'TIMEOUT',
              'Operation exceeded its deadline.',
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
    this.events.onOperationEvent?.({
      kind,
      operationId,
      deviceId,
      capability,
      at,
      ...(data ? { data } : {}),
    });
  }

  private publicSnapshot(op: OperationSnapshot & { abort?: AbortController; owner?: string }): OperationSnapshot {
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
