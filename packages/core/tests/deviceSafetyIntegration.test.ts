import { describe, expect, it, vi } from 'vitest';
import { DeviceInstance, type DeviceBackend } from '../src/runtime/deviceInstance.js';
import { HaltCoordinator } from '../src/halt/haltCoordinator.js';
import { SafetyEngine } from '../src/policy/safety.js';
import type { CapabilityDescriptor } from '../src/types.js';
import type { DeviceIdentity } from '../src/runtime/types.js';

const gpioWrite: CapabilityDescriptor = {
  name: 'gpio.write',
  description: 'Write a pin level',
  inputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: { pin: { type: 'number' }, value: { type: 'number' } },
  },
  outputSchema: { type: 'object', properties: { ok: { type: 'boolean' } } },
  safety: { physicalOutput: true, reversible: true },
};

function makeDevice(
  overrides: {
    halt?: HaltCoordinator;
    safetyEngine?: SafetyEngine;
    backend?: DeviceBackend;
  } = {},
): DeviceInstance {
  const identity: DeviceIdentity = { id: 'esp-01', moduleId: 'pinout/esp32', deviceClass: 'gpio' };
  const backend: DeviceBackend = overrides.backend ?? {
    kind: 'simulated',
    invoke: async (action: string, payload: Record<string, unknown>) => ({
      ok: true,
      action,
      payload,
    }),
    close: async () => undefined,
    subscribe: () => () => undefined,
  };
  return new DeviceInstance({
    identity,
    backend,
    capabilities: [gpioWrite],
    policies: [],
    simulated: true,
    transportKinds: ['simulated'],
    getOperationalState: () => ({ pinMode: 'output' }),
    ...(overrides.halt ? { halt: overrides.halt } : {}),
    ...(overrides.safetyEngine ? { safetyEngine: overrides.safetyEngine } : {}),
  });
}

describe('DeviceInstance safety integration', () => {
  it('rejects invocation when the halt coordinator is engaged', async () => {
    const halt = new HaltCoordinator();
    halt.halt('maintenance');
    const device = makeDevice({ halt });
    await expect(device.invoke('gpio.write', { pin: 2, value: 1 })).rejects.toThrowError(
      /maintenance|halted/i,
    );
  });

  it('allows invocation when halt is normal', async () => {
    const device = makeDevice({ halt: new HaltCoordinator() });
    const result = await device.invoke('gpio.write', { pin: 2, value: 1 });
    expect(result).toMatchObject({ ok: true });
  });

  it('enforces v2 safety rules (rate limit) via the safety engine', async () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'rate', capability: 'gpio.write', maxPerWindow: 1, windowMs: 60_000 }],
    });
    const device = makeDevice({ safetyEngine: engine });
    await device.invoke('gpio.write', { pin: 2, value: 1 });
    await expect(device.invoke('gpio.write', { pin: 2, value: 1 })).rejects.toThrowError(
      /Rate limit/,
    );
  });

  it('refunds consumable safety state when the backend rejects the action', async () => {
    let attempts = 0;
    const backend: DeviceBackend = {
      kind: 'simulated',
      invoke: vi.fn(async () => {
        attempts += 1;
        if (attempts === 1) throw new Error('backend unavailable');
        return { ok: true };
      }),
      close: async () => undefined,
      subscribe: () => () => undefined,
    };
    const engine = new SafetyEngine({
      rules: [{ kind: 'rate', capability: 'gpio.write', maxPerWindow: 1, windowMs: 60_000 }],
    });
    const device = makeDevice({ backend, safetyEngine: engine });

    await expect(device.invoke('gpio.write', { pin: 2, value: 1 })).rejects.toThrow(
      /backend unavailable/,
    );
    await expect(device.invoke('gpio.write', { pin: 2, value: 1 })).resolves.toEqual({ ok: true });
  });

  it('enforces lease-gated capabilities when an owner is passed', async () => {
    const heldLease = {
      id: 'lease-1',
      mode: 'exclusive' as const,
      scope: { kind: 'device' as const, deviceId: 'esp-01' },
      owner: 'agent-a',
      createdAt: 0,
      expiresAt: Number.MAX_SAFE_INTEGER,
      renewable: true,
    };
    const engine = new SafetyEngine({
      rules: [{ kind: 'lease', capability: 'gpio.write' }],
      leaseManager: {
        list: (filter: { owner?: string }) => (filter.owner === 'agent-a' ? [heldLease] : []),
        permits: () => ({ permitted: true }),
      } as never,
    });
    const device = makeDevice({ safetyEngine: engine });
    // With the lease held, the invocation passes; without an owner it fails.
    await expect(
      device.invoke('gpio.write', { pin: 2, value: 1 }, { owner: 'agent-a' }),
    ).resolves.toBeTruthy();
    await expect(device.invoke('gpio.write', { pin: 2, value: 1 })).rejects.toThrowError(
      /requires an active lease/,
    );
  });

  it('dry-run resolves and policy-checks without calling the backend', async () => {
    const backend: DeviceBackend = {
      kind: 'simulated',
      invoke: vi.fn(async () => ({ ok: true })),
      close: async () => undefined,
      subscribe: () => () => undefined,
    };
    const halt = new HaltCoordinator();
    halt.halt('blocked anyway');
    const engine = new SafetyEngine({
      rules: [{ kind: 'numericRange', capability: 'gpio.write', field: 'pin', min: 0, max: 27 }],
    });
    const device = makeDevice({ backend, halt, safetyEngine: engine });

    const plan = await device.invoke('gpio.write', { pin: 2, value: 1 }, { dryRun: true });
    expect(plan).toMatchObject({ dryRun: true, deviceId: 'esp-01', capability: 'gpio.write' });
    expect(plan.resolvedArgs).toEqual({ pin: 2, value: 1 });
    expect(backend.invoke).not.toHaveBeenCalled();
  });

  it('dry-run still rejects invalid args and policy violations', async () => {
    const backend: DeviceBackend = {
      kind: 'simulated',
      invoke: vi.fn(async () => ({ ok: true })),
      close: async () => undefined,
      subscribe: () => () => undefined,
    };
    const engine = new SafetyEngine({
      rules: [{ kind: 'numericRange', capability: 'gpio.write', field: 'pin', min: 0, max: 27 }],
    });
    const device = makeDevice({ backend, safetyEngine: engine });

    await expect(
      device.invoke('gpio.write', { pin: 999, value: 1 }, { dryRun: true }),
    ).rejects.toThrowError(/between 0 and 27/);
    expect(backend.invoke).not.toHaveBeenCalled();
  });
});
