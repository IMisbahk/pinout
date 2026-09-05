import { describe, expect, it } from 'vitest';
import { AbortedError, OperationManager, StopUnconfirmedError } from '../src/index.js';

const tick = (ms = 5) => new Promise((resolve) => setTimeout(resolve, ms));

describe('Recovery: Cancellation vs Confirmed Stop', () => {
  it('records cancelRequested state while cancellation is pending backend acknowledgment', async () => {
    const manager = new OperationManager();
    let cancelSeenInRun = false;

    const op = manager.begin({
      deviceId: 'stepper-01',
      capability: 'stepper.move_steps',
      run: async (ctx) => {
        while (!ctx.cancellationRequested()) {
          await tick(5);
        }
        cancelSeenInRun = true;
        await tick(20); // Delay before acknowledging to test pending state
        ctx.throwIfCancelled();
        return {};
      },
    });

    await tick(10);
    const cancellingPromise = op.handle.cancel('Emergency slow-down');

    // Immediately after cancel() call: status is cancelling and cancelRequestedAt is set
    const inFlightSnapshot = op.handle.snapshot();
    expect(inFlightSnapshot.status).toBe('cancelling');
    expect(inFlightSnapshot.cancelRequestedAt).toBeDefined();
    expect(inFlightSnapshot.cancelRequestedAt).toBeGreaterThan(0);

    const terminalSnapshot = await cancellingPromise;
    expect(cancelSeenInRun).toBe(true);
    expect(terminalSnapshot.status).toBe('cancelled');
    expect(terminalSnapshot.error?.code).toBe('OPERATION_CANCELLED');
    expect(terminalSnapshot.error?.details?.stopConfirmed).toBe(true);
  });

  it('marks operation as cancelled with confirmed stop when backend acknowledges abort', async () => {
    const manager = new OperationManager();
    let backendCleanedUp = false;

    const op = manager.begin({
      deviceId: 'dc-motor-01',
      capability: 'motor.set_speed',
      run: async (ctx) => {
        try {
          while (!ctx.signal.aborted) {
            await tick(5);
          }
          throw new AbortedError('motor stop verified by encoder feedback');
        } finally {
          backendCleanedUp = true;
        }
      },
    });

    await tick(10);
    const snapshot = await op.handle.cancel('Stop motor');
    expect(backendCleanedUp).toBe(true);
    expect(snapshot.status).toBe('cancelled');
    expect(snapshot.error?.details?.stopConfirmed).toBe(true);
  });

  it('marks operation as stop_unconfirmed when backend fails to confirm physical stop during cancellation', async () => {
    const manager = new OperationManager();

    const op = manager.begin({
      deviceId: 'robot-arm-01',
      capability: 'motion.move_to',
      run: async (ctx) => {
        while (!ctx.signal.aborted) {
          await tick(5);
        }
        // Backend attempted stop but brake/encoder feedback failed
        throw new StopUnconfirmedError(
          'Brake engagement timeout; physical axis position uncertain',
        );
      },
    });

    await tick(10);
    const snapshot = await op.handle.cancel('Stop trajectory');
    expect(snapshot.status).toBe('stop_unconfirmed');
    expect(snapshot.error?.code).toBe('OPERATION_STOP_UNCONFIRMED');
    expect(snapshot.error?.details?.stopConfirmed).toBe(false);

    // Waiting for result rejects with OPERATION_STOP_UNCONFIRMED
    await expect(op.handle.waitForResult()).rejects.toMatchObject({
      code: 'OPERATION_STOP_UNCONFIRMED',
    });

    // Reconciling an unconfirmed stop operation succeeds
    const reconciled = await manager.reconcile(op.handle.id, {
      resolution: 'observedComplete',
      note: 'Operator verified physical arm reached final park position safely',
    });
    expect(reconciled.status).toBe('completed');
    expect(reconciled.reconciled).toBe(true);
  });
});
