import { describe, expect, it } from 'vitest';
import {
  LeaseManager,
  PinoutRuntime,
  relayModule,
  registerModule,
  SafetyEngine,
} from '../src/index.js';

describe('Recovery: Lease Ownership and Restart Invalidation', () => {
  it('prevents competing owners from holding conflicting leases on the same device or capability', () => {
    const leases = new LeaseManager();

    // Owner 1 acquires exclusive device lease
    const leaseA = leases.acquire({
      scope: { kind: 'device', deviceId: 'cnc-mill-01' },
      owner: 'agent-alice',
      ttlMs: 60_000,
    });
    expect(leaseA.owner).toBe('agent-alice');

    // Owner 2 attempts to acquire on same device -> rejected with LEASE_CONFLICT
    expect(() =>
      leases.acquire({
        scope: { kind: 'device', deviceId: 'cnc-mill-01' },
        owner: 'agent-bob',
      }),
    ).toThrowError(/leased by 'agent-alice'/);

    // Capability overlapping lease is also rejected
    expect(() =>
      leases.acquire({
        scope: {
          kind: 'capability',
          deviceId: 'cnc-mill-01',
          capabilities: ['spindle.start'],
        },
        owner: 'agent-bob',
      }),
    ).toThrowError(/leased by 'agent-alice'/);
  });

  it('rejects physical actuation with an expired or stale lease', async () => {
    let now = 1_000_000;
    const leases = new LeaseManager({ now: () => now });
    const safety = new SafetyEngine({
      rules: [{ kind: 'lease', capability: 'relay.set' }],
      leaseManager: leases,
      now: () => now,
    });

    const runtime = new PinoutRuntime({ safetyEngine: safety });
    registerModule(relayModule);
    await runtime.registerFromModule(relayModule.id, {
      id: 'relay-lease-test',
      simulated: true,
    });

    // Acquire lease for 10 seconds
    const lease = leases.acquire({
      scope: { kind: 'device', deviceId: 'relay-lease-test' },
      owner: 'agent-alpha',
      ttlMs: 10_000,
    });
    expect(lease.id).toBeDefined();

    // Invocation while lease is active succeeds
    await expect(
      runtime.invoke('relay-lease-test', 'relay.set', { on: true }, { owner: 'agent-alpha' }),
    ).resolves.toBeDefined();

    // Time passes past TTL (15s elapsed)
    now += 15_000;

    // Stale/expired lease invocation is rejected
    await expect(
      runtime.invoke('relay-lease-test', 'relay.set', { on: false }, { owner: 'agent-alpha' }),
    ).rejects.toThrowError(/requires a lease/);

    await runtime.close();
  });

  it('invalidates in-memory leases across restart so old sessions cannot silently resume commands', async () => {
    // Session 1: Runtime running with LeaseManager
    const firstLeases = new LeaseManager();
    const lease = firstLeases.acquire({
      scope: { kind: 'device', deviceId: 'relay-restart' },
      owner: 'old-session-agent',
      ttlMs: 60_000,
    });

    expect(firstLeases.permits('old-session-agent', 'relay-restart', 'relay.set').permitted).toBe(
      true,
    );

    // Simulate process exit and restart: new LeaseManager starts with fresh state
    const restartedLeases = new LeaseManager();

    // Old session attempts to invoke without acquiring a lease in the new daemon
    const permitVerdict = restartedLeases.permits(
      'old-session-agent',
      'relay-restart',
      'relay.set',
    );
    expect(permitVerdict.permitted).toBe(false);

    // Old lease ID is completely unknown to restarted manager
    expect(restartedLeases.get(lease.id)).toBeUndefined();
    expect(() => restartedLeases.renew(lease.id, 'old-session-agent')).toThrowError(
      /expired or unknown/,
    );
  });
});
