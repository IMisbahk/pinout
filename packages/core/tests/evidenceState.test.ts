import { describe, expect, it, vi } from 'vitest';
import {
  PinoutRuntime,
  DeviceInstance,
  PinoutStructuredError,
  unknownEvidence,
  createEvidenceState,
  recordCommanded,
  recordAcknowledged,
  recordObserved,
  computeFreshness,
  isStale,
  hasObservedValue,
  formatIsoTimestamp,
  type CapabilityDescriptor,
  type DeviceBackend,
  type DeviceIdentity,
} from '@pinout/core';

const gpioWriteCapability: CapabilityDescriptor = {
  name: 'gpio.write',
  description: 'Write a GPIO pin level.',
  inputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: { type: 'number' },
      value: { type: 'boolean' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: { type: 'number' },
      value: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};

const gpioReadCapability: CapabilityDescriptor = {
  name: 'gpio.read',
  description: 'Read a GPIO pin level.',
  inputSchema: {
    type: 'object',
    required: ['pin'],
    properties: {
      pin: { type: 'number' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: { type: 'number' },
      value: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

const laserFireCapability: CapabilityDescriptor = {
  name: 'laser.fire',
  description: 'Fire a high-power laser cutter.',
  inputSchema: {
    type: 'object',
    properties: {
      power: { type: 'number' },
    },
  },
  outputSchema: {
    type: 'object',
    properties: {
      fired: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: true, reversible: false },
};

function createTestDevice(options: {
  id?: string;
  simulated?: boolean;
  capabilities?: CapabilityDescriptor[];
  backendInvoke?: (action: string, payload: Record<string, unknown>) => Promise<Record<string, unknown>>;
  getOperationalState?: () => Record<string, unknown>;
  prerequisites?: Record<string, Array<{ key: string; expectedValue?: unknown; maxAgeMs?: number }>>;
  maxStateAgeMs?: number | Record<string, number>;
} = {}): DeviceInstance {
  const identity: DeviceIdentity = {
    id: options.id ?? 'test-device-01',
    moduleId: 'test/evidence-module',
    deviceClass: 'controller',
  };

  let pinLevel = false;

  const backend: DeviceBackend = {
    kind: options.simulated !== false ? 'simulated' : 'protocol',
    invoke: options.backendInvoke ?? (async (action, payload) => {
      if (action === 'gpio.write') {
        pinLevel = Boolean(payload.value);
        return { pin: payload.pin, value: payload.value };
      }
      if (action === 'gpio.read') {
        return { pin: payload.pin, value: pinLevel };
      }
      if (action === 'laser.fire') {
        return { fired: true };
      }
      return { ok: true };
    }),
    close: async () => undefined,
    subscribe: () => () => undefined,
    getOperationalState: options.getOperationalState ?? (() => ({ pinLevel })),
  };

  return new DeviceInstance({
    identity,
    backend,
    capabilities: options.capabilities ?? [gpioWriteCapability, gpioReadCapability, laserFireCapability],
    policies: [],
    simulated: options.simulated !== false,
    transportKinds: ['simulated'],
    getOperationalState: () => backend.getOperationalState?.() ?? {},
    prerequisites: options.prerequisites,
    maxStateAgeMs: options.maxStateAgeMs,
  });
}

describe('Evidence State helpers and type contracts', () => {
  it('creates unknownEvidence with null values and source none', () => {
    const evidence = unknownEvidence('simulated');
    expect(evidence.commanded).toEqual({ value: null, at: null, source: 'none' });
    expect(evidence.acknowledged).toEqual({ value: null, at: null, source: 'none' });
    expect(evidence.observed).toEqual({ value: null, at: null, source: 'none' });
    expect(evidence.freshnessMs).toBeNull();
    expect(evidence.stale).toBe(false);
    expect(evidence.provenance).toBe('simulated');
    expect(hasObservedValue(evidence)).toBe(false);
  });

  it('records commanded, acknowledged, and observed independently', () => {
    let state = unknownEvidence('hardware');
    const nowIso = new Date().toISOString();

    state = recordCommanded(state, true, nowIso);
    expect(state.commanded).toEqual({ value: true, at: nowIso, source: 'commanded' });
    expect(state.acknowledged.value).toBeNull();
    expect(state.observed.value).toBeNull();

    state = recordAcknowledged(state, true, nowIso);
    expect(state.acknowledged).toEqual({ value: true, at: nowIso, source: 'acknowledged' });
    expect(state.observed.value).toBeNull();

    state = recordObserved(state, true, 'gpio-readback', nowIso);
    expect(state.observed).toEqual({ value: true, at: nowIso, source: 'gpio-readback' });
    expect(state.freshnessMs).toBe(0);
    expect(state.stale).toBe(false);
    expect(hasObservedValue(state)).toBe(true);
  });

  it('computes freshness and staleness based on timestamps', () => {
    const t0 = 1_000_000;
    const iso0 = formatIsoTimestamp(t0);

    let state = unknownEvidence('simulated');
    state = recordObserved(state, 'open', 'sensor', iso0);

    // Fresh at t0
    const freshAt0 = computeFreshness(state, t0, 5000);
    expect(freshAt0.freshnessMs).toBe(0);
    expect(freshAt0.stale).toBe(false);
    expect(isStale(state, 5000, t0)).toBe(false);

    // After 4000ms: within maxAgeMs 5000ms
    const at4000 = computeFreshness(state, t0 + 4000, 5000);
    expect(at4000.freshnessMs).toBe(4000);
    expect(at4000.stale).toBe(false);
    expect(isStale(state, 5000, t0 + 4000)).toBe(false);

    // After 6000ms: exceeds maxAgeMs 5000ms -> stale
    const at6000 = computeFreshness(state, t0 + 6000, 5000);
    expect(at6000.freshnessMs).toBe(6000);
    expect(at6000.stale).toBe(true);
    expect(isStale(state, 5000, t0 + 6000)).toBe(true);

    // Staleness preserves the observed value without clearing it
    expect(at6000.observed.value).toBe('open');
    expect(at6000.observed.source).toBe('sensor');
  });

  it('preserves unknown values as null without coercing to false or defaults', () => {
    const custom = createEvidenceState({
      commanded: { value: null, at: null, source: 'none' },
      provenance: 'unknown',
    });
    expect(custom.commanded.value).toBeNull();
    expect(custom.observed.value).toBeNull();
  });
});

describe('DeviceInstance & PinoutRuntime Physical Evidence Integration', () => {
  it('does not infer physical success from a successful write', async () => {
    const runtime = new PinoutRuntime();
    const device = createTestDevice({ id: 'actuator-01', simulated: true });
    await runtime.register(device);

    // Perform a physical write
    const writeResult = await runtime.invoke('actuator-01', 'gpio.write', { pin: 2, value: true });
    expect(writeResult).toEqual({ pin: 2, value: true });

    const evidence = device.getStateEvidence();
    const pinEvidence = evidence['gpio.2'];

    expect(pinEvidence).toBeDefined();
    // Commanded and Acknowledged are set
    expect(pinEvidence.commanded.value).toBe(true);
    expect(pinEvidence.commanded.source).toBe('commanded');
    expect(pinEvidence.acknowledged.value).toBe(true);
    expect(pinEvidence.acknowledged.source).toBe('acknowledged');

    // Observed MUST remain null and unobserved! Physical success is NEVER inferred from a write!
    expect(pinEvidence.observed.value).toBeNull();
    expect(pinEvidence.observed.at).toBeNull();
    expect(pinEvidence.observed.source).toBe('none');
    expect(pinEvidence.freshnessMs).toBeNull();
    expect(pinEvidence.provenance).toBe('simulated');

    await runtime.close();
  });

  it('updates observed state with timestamp and freshness on independent read', async () => {
    const runtime = new PinoutRuntime();
    const device = createTestDevice({ id: 'sensor-device-01', simulated: true });
    await runtime.register(device);

    // Independent read action
    const readResult = await runtime.invoke('sensor-device-01', 'gpio.read', { pin: 2 });
    expect(readResult).toEqual({ pin: 2, value: false });

    const evidence = device.getStateEvidence();
    const pinEvidence = evidence['gpio.2'];

    expect(pinEvidence).toBeDefined();
    expect(pinEvidence.observed.value).toBe(false);
    expect(pinEvidence.observed.at).toBeTruthy();
    expect(pinEvidence.observed.source).toBe('simulated');
    expect(typeof pinEvidence.freshnessMs).toBe('number');
    expect(pinEvidence.stale).toBe(false);

    await runtime.close();
  });

  it('computes staleness correctly over time while preserving value', async () => {
    vi.useFakeTimers();
    try {
      const runtime = new PinoutRuntime();
      const device = createTestDevice({
        id: 'timed-device',
        simulated: true,
        maxStateAgeMs: { 'gpio.2': 1000 },
      });
      await runtime.register(device);

      // Perform read to establish observation at t=0
      await runtime.invoke('timed-device', 'gpio.read', { pin: 2 });

      let ev = device.getStateEvidence()['gpio.2']!;
      expect(ev.stale).toBe(false);
      expect(ev.freshnessMs).toBe(0);

      // Advance virtual time by 500ms -> still fresh
      vi.advanceTimersByTime(500);
      ev = device.getStateEvidence()['gpio.2']!;
      expect(ev.freshnessMs).toBe(500);
      expect(ev.stale).toBe(false);

      // Advance virtual time past 1000ms maxAgeMs (total 1500ms) -> marked stale
      vi.advanceTimersByTime(1000);
      ev = device.getStateEvidence()['gpio.2']!;
      expect(ev.freshnessMs).toBe(1500);
      expect(ev.stale).toBe(true);
      // Value is preserved, not erased!
      expect(ev.observed.value).toBe(false);

      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects action with PREREQUISITE_MISSING when required observation is absent', async () => {
    const runtime = new PinoutRuntime();
    const device = createTestDevice({
      id: 'laser-cutter',
      simulated: true,
      prerequisites: {
        'laser.fire': [
          { key: 'door', expectedValue: 'closed', maxAgeMs: 5000 },
          { key: 'chiller_flow', expectedValue: true, maxAgeMs: 2000 },
        ],
      },
    });
    await runtime.register(device);

    // Invocations fail immediately with structured PREREQUISITE_MISSING
    await expect(runtime.invoke('laser-cutter', 'laser.fire', { power: 80 })).rejects.toThrowError(
      PinoutStructuredError,
    );

    try {
      await runtime.invoke('laser-cutter', 'laser.fire', { power: 80 });
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect(error).toBeInstanceOf(PinoutStructuredError);
      const structured = error as PinoutStructuredError;
      expect(structured.code).toBe('PREREQUISITE_MISSING');
      expect(structured.details.key).toBe('door');
      expect(structured.details.expectedValue).toBe('closed');
      expect(structured.details.observedValue).toBeNull();
    }

    await runtime.close();
  });

  it('rejects action with PREREQUISITE_STALE when observation exceeds maxAgeMs', async () => {
    vi.useFakeTimers();
    try {
      const runtime = new PinoutRuntime();
      const device = createTestDevice({
        id: 'laser-cutter-stale',
        simulated: true,
        prerequisites: {
          'laser.fire': [{ key: 'door', expectedValue: 'closed', maxAgeMs: 1000 }],
        },
      });
      await runtime.register(device);

      // Manually record fresh physical observation
      device.recordObservedState('door', 'closed', 'sensor');

      // Valid immediately
      const first = await runtime.invoke('laser-cutter-stale', 'laser.fire', { power: 50 });
      expect(first).toEqual({ fired: true });

      // Advance virtual time by 2000ms (> 1000ms maxAgeMs)
      vi.advanceTimersByTime(2000);

      // Now execution is rejected with PREREQUISITE_STALE
      await expect(runtime.invoke('laser-cutter-stale', 'laser.fire', { power: 50 })).rejects.toThrowError(
        PinoutStructuredError,
      );

      try {
        await runtime.invoke('laser-cutter-stale', 'laser.fire', { power: 50 });
        expect.unreachable('Should have thrown');
      } catch (error) {
        expect(error).toBeInstanceOf(PinoutStructuredError);
        const structured = error as PinoutStructuredError;
        expect(structured.code).toBe('PREREQUISITE_STALE');
        expect(structured.details.key).toBe('door');
        expect(structured.details.maxAgeMs).toBe(1000);
        expect(structured.details.ageMs).toBeGreaterThan(1000);
      }

      await runtime.close();
    } finally {
      vi.useRealTimers();
    }
  });

  it('includes state evidence in device summaries and runtime events', async () => {
    const runtime = new PinoutRuntime();
    const emittedEnvelopes: Array<Record<string, unknown>> = [];
    runtime.on((env) => emittedEnvelopes.push(env as unknown as Record<string, unknown>));

    const device = createTestDevice({ id: 'monitored-01', simulated: true });
    await runtime.register(device);

    await runtime.invoke('monitored-01', 'gpio.read', { pin: 2 });

    const summaries = runtime.devices();
    expect(summaries[0]?.stateEvidence).toBeDefined();
    expect(summaries[0]?.stateEvidence?.['gpio.2']?.observed.value).toBe(false);

    // Global runtime accessor
    const allEvidence = runtime.getStateEvidence();
    expect(allEvidence['monitored-01']?.['gpio.2']?.observed.value).toBe(false);

    const singleEvidence = runtime.getStateEvidence('monitored-01');
    expect(singleEvidence['gpio.2']?.observed.value).toBe(false);

    await runtime.close();
  });

  it('preserves backward compatibility for legacy state readers', async () => {
    const runtime = new PinoutRuntime();
    const device = createTestDevice({
      id: 'legacy-compat-01',
      simulated: true,
      getOperationalState: () => ({ customKey: 'customValue', active: true }),
    });
    await runtime.register(device);

    // Existing getOperationalStateSnapshot continues to work without modification
    const snapshot = device.getOperationalStateSnapshot();
    expect(snapshot).toEqual({ customKey: 'customValue', active: true });

    // Health lifecycle remains untouched
    expect(device.getHealth().lifecycle).toBe('ready');

    await runtime.close();
  });
});
