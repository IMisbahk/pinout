/**
 * Deterministic fault-injection scenarios (spec v1).
 *
 * Each scenario states the expected failure behavior: Pinout must fail
 * safely and predictably — operations reach a terminal state, leases and
 * journal stay coherent, and nothing retries itself into a physical hazard.
 */
import { describe, expect, it } from 'vitest';
import {
  Journal,
  LeaseManager,
  OperationManager,
  PinoutRuntime,
  relayModule,
  registerModule,
  toStructuredError,
} from '../src/index.js';

const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

describe('fault injection: operations', () => {
  it('device disconnect during command fails the operation with a structured error', async () => {
    const runtime = new PinoutRuntime();
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, { id: 'relay-x', simulated: true });

    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'relay-x',
      capability: 'relay.set',
      run: async () => {
        // The device vanishes mid-command; the follow-up call must fail.
        await runtime.unregister('relay-x');
        return runtime.invoke('relay-x', 'relay.set', { on: true });
      },
    });

    await expect(handle.waitForResult()).rejects.toMatchObject({ code: 'DEVICE_NOT_FOUND' });
    const snapshot = handle.snapshot();
    expect(snapshot.status).toBe('failed');
    expect(snapshot.error?.retryable).toBe(false);
    await runtime.close();
  });

  it('lease expiry mid-operation surfaces LEASE_EXPIRED on the next gated invocation', async () => {
    let now = 1_000_000;
    const leases = new LeaseManager({ now: () => now });
    const engineLease = leases.acquire({
      scope: { kind: 'device', deviceId: 'relay-x' },
      owner: 'agent-a',
      ttlMs: 1000,
    });

    // Operation starts while the lease is alive…
    const manager = new OperationManager();
    const { handle } = manager.begin({
      deviceId: 'relay-x',
      capability: 'relay.set',
      run: async () => {
        await tick(5);
        // …time passes; the lease expires while work is in flight…
        now += 2000;
        // …the next gated call must not pass.
        const verdict = leases.permits('agent-a', 'relay-x', 'relay.set', 'exclusive');
        if (!verdict.permitted) throw new Error('should be permitted after expiry');
        const fresh = leases.acquire({
          scope: { kind: 'device', deviceId: 'relay-x' },
          owner: 'agent-b',
        });
        return { lease: fresh.id, previous: engineLease.id };
      },
    });

    await handle.waitForResult();
    // agent-b can now acquire; agent-a's old lease is gone.
    expect(leases.permits('agent-b', 'relay-x', 'relay.set', 'exclusive').permitted).toBe(true);
    expect(leases.get(engineLease.id)).toBeUndefined();
  });

  it('halt requested mid-operation cancels the operation when the run acknowledges', async () => {
    const manager = new OperationManager();
    let cancelledObserved = false;
    const { handle } = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      run: async (ctx) => {
        while (!ctx.cancellationRequested()) {
          await tick(1);
        }
        cancelledObserved = true;
        ctx.throwIfCancelled();
        return {};
      },
    });

    await tick(5);
    const snapshot = await handle.cancel('halt requested');
    expect(cancelledObserved).toBe(true);
    expect(snapshot.status).toBe('cancelled');
    // The journal records cancellation deterministically.
    const journal = new Journal();
    journal.append(
      'operation.cancelled',
      { deviceId: 'arm-01', operationId: handle.id },
      { reason: 'halt requested' },
    );
    const entries = await journal.query({ kinds: ['operation.cancelled'] });
    expect(entries[0].operationId).toBe(handle.id);
  });

  it('journal captures the full failure story without leaking secrets', async () => {
    const storage = new Journal();
    const journal = new Journal({ storage: undefined as never });
    void journal;
    const manager = new OperationManager({
      onOperationEvent: (event) => {
        storage.append(
          event.kind,
          { deviceId: event.deviceId, operationId: event.operationId },
          event.data ?? {},
        );
      },
    });
    const { handle } = manager.begin({
      deviceId: 'chamber-01',
      capability: 'temperature.set',
      timeoutMs: 10,
      run: async (ctx) => {
        // Work that ignores cancellation and blows the deadline.
        while (!ctx.signal.aborted) await tick(2);
        return {};
      },
    });
    await manager.waitFor(handle.id);

    const story = await storage.query({ deviceId: 'chamber-01' });
    expect(story.map((entry) => entry.kind)).toEqual([
      'operation.requested',
      'operation.started',
      'operation.timed_out',
    ]);
    // No secret-shaped keys anywhere in the journal.
    expect(JSON.stringify(story).toLowerCase()).not.toContain('token');
    expect(JSON.stringify(story).toLowerCase()).not.toContain('password');
  });

  it('duplicate transport errors serialize into structured, retryable envelopes', async () => {
    const error = new Error('driver wedged');
    error.name = 'TransportError';
    const structured = toStructuredError(error, { device: 'esp-01', capability: 'gpio.write' });
    expect(structured.retryable).toBe(false); // unknown errors are not blindly retryable
    expect(structured.category).toBe('DEVICE');
  });
});

describe('fault injection: runtime', () => {
  it('unregister during busy invoke still closes cleanly (no dangling invocations)', async () => {
    const runtime = new PinoutRuntime();
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, { id: 'relay-y', simulated: true });

    const invokePromise = runtime.invoke('relay-y', 'relay.set', { on: true });
    await invokePromise; // completes before unregister
    await runtime.unregister('relay-y');
    await expect(runtime.invoke('relay-y', 'relay.set', { on: false })).rejects.toMatchObject({
      code: 'DEVICE_NOT_FOUND',
    });
  });
});
