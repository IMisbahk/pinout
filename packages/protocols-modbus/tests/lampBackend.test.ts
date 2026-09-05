import { describe, expect, it } from 'vitest';
import { DeviceError, runLampConformance, type LampStatus } from '@pinout/core';
import {
  createModbusLampBackend,
  ModbusLampBackend,
  validateModbusLampConfig,
} from '../src/lampBackend.js';
import { SimulatedModbusServer } from '../src/simulator.js';
import { ModbusTcpClient } from '../src/tcpClient.js';

describe('ModbusLampBackend Config Validation', () => {
  it('allows default configuration for empty options', () => {
    const config = validateModbusLampConfig({}, true);
    expect(config.coil).toBe(0);
    expect(config.polarity).toBe('active-high');
    expect(config.safeLevel).toBe('low');
    expect(config.provenance).toBe('simulated');
    expect(config.requireWatchdog).toBe(true);
  });

  it('rejects missing coil when allowEmptyDefaults is false', () => {
    expect(() => validateModbusLampConfig({}, false)).toThrowError(DeviceError);
    try {
      validateModbusLampConfig({}, false);
    } catch (error) {
      expect((error as DeviceError).code).toBe('UNSUPPORTED_CONFIGURATION');
    }
  });

  it('rejects invalid polarity', () => {
    expect(() =>
      validateModbusLampConfig({ coil: 1, polarity: 'invalid' as unknown as LampPolarity }, false),
    ).toThrowError(DeviceError);
  });

  it('rejects active-high with safeLevel high', () => {
    try {
      validateModbusLampConfig({ coil: 1, polarity: 'active-high', safeLevel: 'high' }, false);
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect((error as DeviceError).code).toBe('UNSUPPORTED_CONFIGURATION');
      expect((error as DeviceError).message).toMatch(/energize the lamp/);
    }
  });

  it('rejects active-low with safeLevel low', () => {
    try {
      validateModbusLampConfig({ coil: 1, polarity: 'active-low', safeLevel: 'low' }, false);
      expect.unreachable('Should have thrown');
    } catch (error) {
      expect((error as DeviceError).code).toBe('UNSUPPORTED_CONFIGURATION');
      expect((error as DeviceError).message).toMatch(/energize the lamp/);
    }
  });

  it('accepts valid active-low with safeLevel high', () => {
    const config = validateModbusLampConfig(
      { coil: 2, polarity: 'active-low', safeLevel: 'high' },
      false,
    );
    expect(config.polarity).toBe('active-low');
    expect(config.safeLevel).toBe('high');
  });

  it('rejects out of bounds coil and discrete input numbers', () => {
    expect(() => validateModbusLampConfig({ coil: -1 }, false)).toThrowError(DeviceError);
    expect(() => validateModbusLampConfig({ coil: 70000 }, false)).toThrowError(DeviceError);
    expect(() => validateModbusLampConfig({ coil: 1, discreteInput: -1 }, false)).toThrowError(
      DeviceError,
    );
  });
});

describe('ModbusLampBackend Lifecycle and Evidence', () => {
  it('starts disarmed and rejects actuation before arming', async () => {
    const backend = await createModbusLampBackend({
      coil: 1,
      polarity: 'active-high',
      requireWatchdog: false,
    });

    try {
      const status = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(status.armed).toBe('disarmed');

      await expect(backend.invoke('lamp.on', {})).rejects.toMatchObject({
        code: 'NOT_ARMED',
      });
      await expect(backend.invoke('lamp.off', {})).rejects.toMatchObject({
        code: 'NOT_ARMED',
      });
      await expect(backend.invoke('lamp.set', { on: true })).rejects.toMatchObject({
        code: 'NOT_ARMED',
      });
    } finally {
      await backend.close();
    }
  });

  it('enforces watchdog requirement on arm when requireWatchdog is true', async () => {
    const backend = await createModbusLampBackend({
      coil: 1,
      polarity: 'active-high',
      requireWatchdog: true,
    });

    try {
      await expect(backend.invoke('lamp.arm', {})).rejects.toMatchObject({
        code: 'WATCHDOG_NOT_SUPPORTED',
      });

      // Explicitly acknowledging watchdog limitation allows arming
      const armResult = await backend.invoke('lamp.arm', { requireWatchdog: false });
      expect(armResult.armed).toBe('armed');
    } finally {
      await backend.close();
    }
  });

  it('arms, actuates on/off, and accurately reports evidence without discrete input', async () => {
    const backend = await createModbusLampBackend({
      coil: 0,
      polarity: 'active-high',
      requireWatchdog: false,
    });

    try {
      await backend.invoke('lamp.arm', {});

      const onResult = await backend.invoke('lamp.on', {});
      expect(onResult.on).toBe(true);

      const statusOn = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(statusOn.commanded.on).toBe(true);
      expect(statusOn.commanded.source).toBe('commanded');
      expect(typeof statusOn.commanded.at).toBe('string');
      expect(statusOn.acknowledged.on).toBe(true);
      expect(statusOn.acknowledged.source).toBe('acknowledged');
      expect(typeof statusOn.acknowledged.at).toBe('string');
      // No discrete input readback -> observed is null with source 'none'
      expect(statusOn.observed.on).toBeNull();
      expect(statusOn.observed.source).toBe('none');
      expect(statusOn.freshnessMs).toBeNull();
      expect(statusOn.provenance).toBe('simulated');
      expect(statusOn.armed).toBe('armed');

      const offResult = await backend.invoke('lamp.off', {});
      expect(offResult.on).toBe(false);

      const statusOff = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(statusOff.commanded.on).toBe(false);
      expect(statusOff.acknowledged.on).toBe(false);
    } finally {
      await backend.close();
    }
  });

  it('reads independent observation from discrete input', async () => {
    const backend = await createModbusLampBackend({
      coil: 1,
      discreteInput: 5,
      polarity: 'active-high',
      readbackPolarity: 'active-high',
      requireWatchdog: false,
    });

    try {
      await backend.invoke('lamp.arm', {});
      await backend.invoke('lamp.on', {});

      const status = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(status.commanded.on).toBe(true);
      expect(status.acknowledged.on).toBe(true);
      expect(status.observed.on).toBe(true);
      expect(status.observed.source).toBe('simulated');
      expect(typeof status.observed.at).toBe('string');
      expect(status.freshnessMs).toBeGreaterThanOrEqual(0);
    } finally {
      await backend.close();
    }
  });

  it('honestly exposes simulated wiring fault where discrete input disagrees with commanded coil', async () => {
    const server = new SimulatedModbusServer();
    const { port } = await server.start();
    const client = new ModbusTcpClient({ host: '127.0.0.1', port, unitId: 1 });
    await client.connect();

    const config = validateModbusLampConfig(
      {
        coil: 0,
        discreteInput: 1,
        polarity: 'active-high',
        readbackPolarity: 'active-high',
        requireWatchdog: false,
      },
      false,
    );

    const backend = new ModbusLampBackend(client, config, server);

    try {
      await backend.invoke('lamp.arm', {});
      await backend.invoke('lamp.on', {});

      // Inject a wiring fault: lamp was commanded ON and coil is ON,
      // but the physical sensor/discrete input on input 1 reports FALSE (e.g. broken filament, open circuit)
      backend.setSimulatedReadbackLevel(false);

      const status = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(status.commanded.on).toBe(true);
      expect(status.acknowledged.on).toBe(true);
      // Observed shows FALSE — disagreement is honestly reported, no auto-correction!
      expect(status.observed.on).toBe(false);
      expect(status.observed.on).not.toBe(status.commanded.on);
      expect(status.observed.source).toBe('simulated');

      // Generic evidence state also preserves the discrepancy
      const evidence = backend.getOperationalStateEvidence();
      expect(evidence.on.commanded.value).toBe(true);
      expect(evidence.on.acknowledged.value).toBe(true);
      expect(evidence.on.observed.value).toBe(false);
    } finally {
      await backend.close();
    }
  });

  it('handles maxOnMs continuous on-time auto-shutoff', async () => {
    const backend = await createModbusLampBackend({
      coil: 2,
      polarity: 'active-high',
      maxOnMs: 40,
      requireWatchdog: false,
    });

    try {
      await backend.invoke('lamp.arm', {});
      await backend.invoke('lamp.on', {});

      const onStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(onStatus.commanded.on).toBe(true);

      // Wait for maxOn timer to expire
      await new Promise((resolve) => setTimeout(resolve, 60));

      const offStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(offStatus.commanded.on).toBe(false);
      expect(offStatus.acknowledged.on).toBe(false);
    } finally {
      await backend.close();
    }
  });

  it('disarm applies safe level and prevents actuation', async () => {
    const backend = await createModbusLampBackend({
      coil: 3,
      polarity: 'active-high',
      requireWatchdog: false,
    });

    try {
      await backend.invoke('lamp.arm', {});
      await backend.invoke('lamp.on', {});

      const disarmResult = await backend.invoke('lamp.disarm', {});
      expect(disarmResult.armed).toBe('disarmed');

      const status = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(status.armed).toBe('disarmed');

      await expect(backend.invoke('lamp.on', {})).rejects.toMatchObject({
        code: 'NOT_ARMED',
      });
    } finally {
      await backend.close();
    }
  });

  it('recovers from watchdog trip with re-arm', async () => {
    const backend = await createModbusLampBackend({
      coil: 4,
      polarity: 'active-high',
      requireWatchdog: false,
    });

    try {
      await backend.invoke('lamp.arm', {});
      backend.injectTrip('TEST_TIMEOUT');

      const trippedStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(trippedStatus.armed).toBe('tripped');

      await expect(backend.invoke('lamp.on', {})).rejects.toMatchObject({
        code: 'WATCHDOG_TRIPPED',
      });

      // Re-arm recovers
      await backend.invoke('lamp.arm', { requireWatchdog: false });
      const rearmedStatus = (await backend.invoke('lamp.status', {})) as LampStatus;
      expect(rearmedStatus.armed).toBe('armed');

      const onResult = await backend.invoke('lamp.on', {});
      expect(onResult.on).toBe(true);
    } finally {
      await backend.close();
    }
  });
});

describe('ModbusLampBackend Shared Conformance Suite', () => {
  it('passes shared lamp conformance suite without readback', async () => {
    const result = await runLampConformance(
      () =>
        createModbusLampBackend({
          coil: 0,
          polarity: 'active-high',
          safeLevel: 'low',
          requireWatchdog: false,
        }),
      { hasReadback: false },
    );

    expect(result.passed).toBe(true);
    for (const check of result.checks) {
      expect(check.status).not.toBe('failed');
    }
  });

  it('passes shared lamp conformance suite with discrete input readback', async () => {
    const result = await runLampConformance(
      () =>
        createModbusLampBackend({
          coil: 0,
          discreteInput: 1,
          polarity: 'active-high',
          safeLevel: 'low',
          readbackPolarity: 'active-high',
          requireWatchdog: false,
        }),
      { hasReadback: true },
    );

    expect(result.passed).toBe(true);
    for (const check of result.checks) {
      expect(check.status).not.toBe('failed');
    }
  });
});
