import { describe, expect, it } from 'vitest';
import {
  DeviceInstance,
  coffeeMachineModule,
  createSimulatedCoffeeMachineBackend,
} from '@pinout/core';

describe('coffee-machine simulator', () => {
  it('exposes the semantic contract and safe state', async () => {
    const backend = createSimulatedCoffeeMachineBackend({ temperature: 92 });
    const device = new DeviceInstance({
      identity: {
        id: 'coffee',
        moduleId: coffeeMachineModule.id,
        deviceClass: coffeeMachineModule.deviceClass,
      },
      backend,
      capabilities: coffeeMachineModule.capabilities,
      policies: coffeeMachineModule.policies,
      simulated: true,
      transportKinds: ['simulated'],
      getOperationalState: () => backend.getOperationalState?.() ?? {},
    });
    expect(device.capabilityNames()).toEqual(
      expect.arrayContaining([
        'water_level.read',
        'temperature.read',
        'heater.set',
        'pump.start',
        'pump.stop',
        'brew.start',
        'brew.stop',
        'status.read',
      ]),
    );
    await expect(device.invoke('heater.set', { enabled: true })).resolves.toEqual({
      enabled: true,
    });
    await device.invoke('brew.start', { shots: 1 });
    expect((await device.invoke('status.read')).status).toBe('brewing');
    await device.applySafeState();
    expect(await device.invoke('status.read')).toMatchObject({
      status: 'ready',
      pump: 'off',
      heater: false,
    });
    await device.close();
  });

  it('fails closed for low water and reports deterministic progress/faults', async () => {
    const backend = createSimulatedCoffeeMachineBackend({
      waterLevel: 'low',
      brewDurationMs: 1000,
      now: () => 0,
    });
    await expect(backend.invoke('brew.start', {})).rejects.toMatchObject({
      code: 'INTERLOCK_OPEN',
    });
    const good = createSimulatedCoffeeMachineBackend({ brewDurationMs: 1000, now: () => 0 });
    await good.invoke('brew.start', {});
    good.advance(500);
    expect(good.getOperationalState()).toMatchObject({
      status: 'brewing',
      brew: { progress: 0.5 },
      pump: 'running',
    });
    good.injectFault('disconnect mid-brew');
    expect(good.getOperationalState()).toMatchObject({
      status: 'faulted',
      pump: 'off',
      brew: { status: 'failed', reason: 'disconnect mid-brew' },
    });
  });
});
