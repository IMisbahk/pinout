import { describe, expect, it } from 'vitest';
import {
  Journal,
  OperationManager,
} from '../src/index.js';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Recovery: Reconciliation', () => {
  it('reconciles an uncertain operation with observedComplete', async () => {
    const journal = new Journal();
    const emittedEvents: Array<{ kind: string; data?: Record<string, unknown> }> = [];
    const manager = new OperationManager(
      {
        onOperationEvent: (event) => emittedEvents.push({ kind: event.kind, data: event.data }),
      },
      undefined,
      { journal },
    );

    const op = manager.begin({
      deviceId: 'valve-01',
      capability: 'valve.open',
      owner: 'operator-1',
      idempotencyKey: 'valve-key-1',
      testHooks: {
        afterDispatchBeforeAck: () => {
          throw new Error('crash after dispatch');
        },
      },
      run: async () => ({ opened: true }),
    });

    await tick(10);
    expect(op.handle.snapshot().status).toBe('requires_reconciliation');

    // Reconcile as observedComplete
    const reconciled = await manager.reconcile(op.handle.id, {
      resolution: 'observedComplete',
      note: 'Operator verified valve position is fully OPEN via visual check',
      actor: 'operator-alice',
      result: { opened: true, verifiedBy: 'optical-sensor' },
    });

    expect(reconciled.status).toBe('completed');
    expect(reconciled.reconciled).toBe(true);
    expect(reconciled.reconciliation).toEqual({
      resolution: 'observedComplete',
      note: 'Operator verified valve position is fully OPEN via visual check',
      actor: 'operator-alice',
      reconciledAt: expect.any(Number),
    });
    expect(reconciled.result).toEqual({ opened: true, verifiedBy: 'optical-sensor' });
    expect(reconciled.error).toBeUndefined();

    // Verify handle.waitForResult() resolves with the reconciled result
    const result = await op.handle.waitForResult();
    expect(result).toEqual({ opened: true, verifiedBy: 'optical-sensor' });

    // Verify subsequent retry with same idempotency key returns completed snapshot
    const retry = manager.begin({
      deviceId: 'valve-01',
      capability: 'valve.open',
      owner: 'operator-1',
      idempotencyKey: 'valve-key-1',
      run: async () => ({ opened: true, fresh: true }),
    });

    expect(retry.deduped).toBe(true);
    expect(retry.handle.snapshot().status).toBe('completed');
    expect(await retry.handle.waitForResult()).toEqual({
      opened: true,
      verifiedBy: 'optical-sensor',
    });

    // Verify journal and event emission
    expect(emittedEvents.some((e) => e.kind === 'operation.reconciled')).toBe(true);
    const journalEntries = await journal.query({ kinds: ['operation.reconciled'] });
    expect(journalEntries).toHaveLength(1);
    expect(journalEntries[0]?.payload?.resolution).toBe('observedComplete');
  });

  it('reconciles an uncertain operation with observedNotDone', async () => {
    const manager = new OperationManager();
    const op = manager.begin({
      deviceId: 'pump-01',
      capability: 'pump.start',
      owner: 'operator-2',
      idempotencyKey: 'pump-key-1',
      testHooks: {
        afterDispatchBeforeAck: () => {
          throw new Error('crash after dispatch');
        },
      },
      run: async () => ({ pump: 'running' }),
    });

    await tick(10);
    expect(op.handle.snapshot().status).toBe('requires_reconciliation');

    const reconciled = await manager.reconcile(op.handle.id, {
      resolution: 'observedNotDone',
      note: 'Flow sensor confirms zero flow occurred',
      actor: 'operator-bob',
    });

    expect(reconciled.status).toBe('cancelled');
    expect(reconciled.reconciled).toBe(true);
    expect(reconciled.reconciliation?.resolution).toBe('observedNotDone');
    expect(reconciled.error?.code).toBe('OPERATION_RECONCILED_NOT_DONE');

    await expect(op.handle.waitForResult()).rejects.toThrowError(
      /Flow sensor confirms zero flow occurred/,
    );
  });

  it('reconciles an uncertain operation with abandoned', async () => {
    const manager = new OperationManager();
    const op = manager.begin({
      deviceId: 'robot-01',
      capability: 'motion.home',
      owner: 'operator-3',
      idempotencyKey: 'robot-key-1',
      testHooks: {
        afterDispatchBeforeAck: () => {
          throw new Error('crash after dispatch');
        },
      },
      run: async () => ({ homed: true }),
    });

    await tick(10);
    expect(op.handle.snapshot().status).toBe('requires_reconciliation');

    const reconciled = await manager.reconcile(op.handle.id, {
      resolution: 'abandoned',
      note: 'Manual reset performed; operation abandoned',
    });

    expect(reconciled.status).toBe('failed');
    expect(reconciled.reconciled).toBe(true);
    expect(reconciled.error?.code).toBe('OPERATION_ABANDONED');

    await expect(op.handle.waitForResult()).rejects.toMatchObject({
      code: 'OPERATION_ABANDONED',
    });
  });

  it('rejects reconciliation for operations that are already completed or not uncertain', async () => {
    const manager = new OperationManager();
    const op = manager.begin({
      deviceId: 'relay-01',
      capability: 'relay.set',
      run: async () => ({ on: true }),
    });

    await op.handle.waitForResult();
    expect(op.handle.snapshot().status).toBe('completed');

    await expect(
      manager.reconcile(op.handle.id, { resolution: 'observedComplete' }),
    ).rejects.toMatchObject({
      code: 'OPERATION_NOT_UNCERTAIN',
    });
  });

  it('rejects reconciliation for unknown operation IDs with OPERATION_NOT_FOUND', async () => {
    const manager = new OperationManager();
    await expect(
      manager.reconcile('op_nonexistent_123', { resolution: 'observedComplete' }),
    ).rejects.toMatchObject({
      code: 'OPERATION_NOT_FOUND',
    });
  });
});
