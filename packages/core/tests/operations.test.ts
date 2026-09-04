import { describe, expect, it, vi } from 'vitest';
import { AbortedError } from '../src/errors.js';
import {
  OperationManager,
  isTerminalOperationStatus,
  type OperationRunContext,
} from '../src/operation/operationManager.js';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('isTerminalOperationStatus', () => {
  it('recognizes terminal statuses', () => {
    expect(isTerminalOperationStatus('completed')).toBe(true);
    expect(isTerminalOperationStatus('cancelled')).toBe(true);
    expect(isTerminalOperationStatus('rejected')).toBe(true);
    expect(isTerminalOperationStatus('failed')).toBe(true);
    expect(isTerminalOperationStatus('timed_out')).toBe(true);
    expect(isTerminalOperationStatus('queued')).toBe(false);
    expect(isTerminalOperationStatus('running')).toBe(false);
    expect(isTerminalOperationStatus('cancelling')).toBe(false);
  });
});

describe('OperationManager', () => {
  it('runs to completion with result and timestamps', async () => {
    const manager = new OperationManager();
    const { handle, deduped } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.home',
      run: async () => ({ homed: true }),
    });
    expect(deduped).toBe(false);
    const result = await handle.waitForResult();
    expect(result).toEqual({ homed: true });
    const snapshot = handle.snapshot();
    expect(snapshot.status).toBe('completed');
    expect(snapshot.startedAt).toBeGreaterThanOrEqual(snapshot.createdAt);
    expect(snapshot.finishedAt).toBeDefined();
  });

  it('emits lifecycle events in order', async () => {
    const kinds: string[] = [];
    const manager = new OperationManager({
      onOperationEvent: (event) => kinds.push(event.kind),
    });
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async (ctx) => {
        ctx.reportProgress(0.5, 'halfway');
        return {};
      },
    });
    await handle.waitForResult();
    expect(kinds).toEqual([
      'operation.requested',
      'operation.started',
      'operation.progress',
      'operation.completed',
    ]);
  });

  it('dedupes concurrent retries with the same idempotency key', async () => {
    const manager = new OperationManager();
    let runs = 0;
    const first = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      idempotencyKey: 'client-retry-1',
      run: async () => {
        runs += 1;
        await tick(20);
        return { attempt: runs };
      },
    });
    const retry = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      idempotencyKey: 'client-retry-1',
      run: async () => ({ attempt: 99 }),
    });
    expect(retry.deduped).toBe(true);
    expect(retry.handle.id).toBe(first.handle.id);
    await first.handle.waitForResult();
    expect(runs).toBe(1);
  });

  it('reports progress through subscribe and async iteration', async () => {
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'trajectory.execute',
      run: async (ctx: OperationRunContext) => {
        for (const fraction of [0.25, 0.5, 0.75]) {
          ctx.reportProgress(fraction);
          await tick(1);
        }
        ctx.reportProgress(1, 'done');
        return {};
      },
    });

    const seen: Array<number | null> = [];
    for await (const progress of handle.progress()) {
      seen.push(progress.fraction);
      if (progress.fraction === 1) break;
    }
    expect(seen).toEqual([0.25, 0.5, 0.75, 1]);
    await handle.waitForResult();
  });

  it('cancels a running operation when the run acknowledges the abort', async () => {
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async (ctx) => {
        while (!ctx.cancellationRequested()) {
          await tick(1);
        }
        ctx.throwIfCancelled();
        return { unreachable: true };
      },
    });
    await tick(5);
    const cancelling = handle.cancel('operator request');
    expect(handle.snapshot().status).toBe('cancelling');
    expect(handle.snapshot().cancelRequestedAt).toBeDefined();
    const snapshot = await cancelling;
    expect(snapshot.status).toBe('cancelled');
    expect(snapshot.error?.code).toBe('OPERATION_CANCELLED');
    await expect(handle.waitForResult()).rejects.toBeInstanceOf(AbortedError);
  });

  it('cancels a queued operation before it starts', async () => {
    const manager = new OperationManager();
    let ran = false;
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async () => {
        ran = true;
        return {};
      },
    });
    const waiting = handle.waitForResult();
    const snapshot = await handle.cancel();
    expect(snapshot.status).toBe('cancelled');
    await expect(waiting).rejects.toBeInstanceOf(AbortedError);
    await tick(10);
    expect(ran).toBe(false);
  });

  it('marks an operation timed_out when it blows its deadline', async () => {
    const manager = new OperationManager();
    const started = Date.now();
    const { handle } = manager.begin({
      deviceId: 'chamber-01',
      capability: 'experiment.start',
      timeoutMs: 20,
      run: async (ctx) => {
        // Ignores cancellation; only the deadline path ends this.
        while (!ctx.signal.aborted && Date.now() - started < 200) await tick(5);
        return {};
      },
    });
    const snapshot = await manager.waitFor(handle.id);
    expect(snapshot.status).toBe('timed_out');
    expect(snapshot.error?.code).toBe('OPERATION_TIMEOUT');
  });

  it('aborts the run signal when a deadline expires', async () => {
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'chamber-01',
      capability: 'experiment.start',
      timeoutMs: 10,
      run: async (ctx) => {
        await new Promise<void>((resolve) => ctx.signal.addEventListener('abort', () => resolve()));
        expect(ctx.signal.aborted).toBe(true);
        ctx.throwIfCancelled();
        return {};
      },
    });
    await expect(handle.waitForResult()).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    expect(handle.snapshot().status).toBe('timed_out');
  });

  it.each(['resolve', 'reject'])('keeps timeout terminal after a late %s', async (outcome) => {
    const manager = new OperationManager();
    let finish!: () => void;
    const late = new Promise<void>((resolve) => {
      finish = resolve;
    });
    const { handle } = manager.begin({
      deviceId: 'arm',
      capability: 'move',
      timeoutMs: 5,
      run: async () => {
        await late;
        if (outcome === 'reject') throw new Error('late fault');
        return { moved: true };
      },
    });
    await expect(handle.waitForResult()).rejects.toMatchObject({ code: 'OPERATION_TIMEOUT' });
    finish();
    await tick();
    expect(handle.snapshot().status).toBe('timed_out');
    expect(handle.snapshot().result).toBeUndefined();
    expect(handle.snapshot().error?.code).toBe('OPERATION_TIMEOUT');
  });

  it('records a failure with the structured error code', async () => {
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async () => {
        throw new Error('motor driver fault');
      },
    });
    await expect(handle.waitForResult()).rejects.toMatchObject({
      code: 'INTERNAL_ERROR',
      message: 'motor driver fault',
    });
    expect(handle.snapshot().status).toBe('failed');
  });

  it('lists operations filtered by device and status', async () => {
    const manager = new OperationManager();
    const slow = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async () => {
        await tick(30);
        return {};
      },
    }).handle;
    const fast = manager.begin({
      deviceId: 'gripper-01',
      capability: 'gripper.close',
      run: async () => ({}),
    }).handle;
    await manager.waitFor(fast.id);
    expect(manager.list({ deviceId: 'gripper-01' })).toHaveLength(1);
    expect(manager.list({ status: 'completed' })).toHaveLength(1);
    expect(manager.list({ status: 'running' }).map((op) => op.id)).toContain(slow.id);
    await slow.waitForResult();
  });

  it('validates progress fraction bounds', async () => {
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async (ctx) => {
        expect(() => ctx.reportProgress(1.5)).toThrow(/within \[0, 1\]/);
        ctx.reportProgress(null, 'indeterminate');
        return {};
      },
    });
    await handle.waitForResult();
    expect(handle.snapshot().progress?.fraction).toBeNull();
  });

  it('exposes snapshots without leaking the abort controller', async () => {
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.home',
      run: async () => ({}),
    });
    await handle.waitForResult();
    const json = JSON.parse(JSON.stringify(handle.snapshot()));
    expect(json.abort).toBeUndefined();
    expect(json.id).toBe(handle.id);
  });

  it('does not report progress after terminal state', async () => {
    const manager = new OperationManager();
    const listener = vi.fn();
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.home',
      run: async () => {
        await tick(10);
        return {};
      },
    });
    handle.subscribe(listener);
    await handle.waitForResult();
    const op = manager.list({ deviceId: 'arm-01' })[0]!;
    expect(op.status).toBe('completed');
    expect(listener).not.toHaveBeenCalled();
  });
});
