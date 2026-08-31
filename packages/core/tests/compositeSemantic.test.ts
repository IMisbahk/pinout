import { describe, expect, it } from 'vitest';
import {
  CompositeDeviceBackend,
  DeviceInstance,
  PinoutRuntime,
  createCompositeBackend,
  createSimulatedPumpBackend,
  createSimulatedRelayBackend,
  pumpModule,
  relayModule,
  getModule,
} from '@pinout/core';

describe('composite backends and semantic modules', () => {
  it('routes capabilities and forwards driver events', async () => {
    const events: string[] = [];
    const backend = createCompositeBackend({
      drivers: { contact: createSimulatedRelayBackend(), flow: createSimulatedPumpBackend() },
      routes: { 'relay.set': { driver: 'contact' }, 'pump.set': { driver: 'flow' } },
    });
    const device = new DeviceInstance({
      identity: { id: 'rig', moduleId: 'test/rig', deviceClass: 'system.rig' },
      backend,
      capabilities: [
        ...relayModule.capabilities,
        ...pumpModule.capabilities.filter((c) => c.name === 'pump.set'),
      ],
      policies: [],
      simulated: true,
      transportKinds: ['simulated'],
      getOperationalState: () => backend.getOperationalState?.() ?? {},
      onRuntimeEvent: (event) => events.push(`${event.event}:${String(event.payload.driver)}`),
    });
    const runtime = new PinoutRuntime();
    await runtime.register(device);
    await runtime.invoke('rig', 'relay.set', { on: true });
    await runtime.invoke('rig', 'pump.set', { speed: 25 });
    expect(events).toEqual(['relay.changed:contact', 'pump.changed:flow']);
    await runtime.close();
    await expect(runtime.invoke('rig', 'relay.set', { on: false })).rejects.toThrow();
  });

  it('forwards events from a registered composite through PinoutRuntime', async () => {
    const runtime = new PinoutRuntime();
    const seen: string[] = [];
    runtime.on((event) => seen.push(`${event.event}:${String(event.payload.driver)}`));
    const device = new DeviceInstance({
      identity: { id: 'event-rig', moduleId: 'test/rig', deviceClass: 'system.rig' },
      backend: createCompositeBackend({
        drivers: { contact: createSimulatedRelayBackend() },
        routes: { 'relay.set': { driver: 'contact' } },
      }),
      capabilities: [relayModule.capabilities[0]!],
      policies: [],
      simulated: true,
      transportKinds: ['simulated'],
      getOperationalState: () => ({}),
    });
    await runtime.register(device);
    await runtime.invoke(device.id, 'relay.set', { on: true });
    expect(seen).toEqual(['relay.changed:contact']);
    await runtime.close();
  });

  it('fails closed for an invalid route and registers semantic modules', async () => {
    expect(getModule('pinout/relay')).toBe(relayModule);
    expect(getModule('pinout/pump')).toBe(pumpModule);
    expect(
      () =>
        new CompositeDeviceBackend({ drivers: {}, routes: { 'relay.set': { driver: 'missing' } } }),
    ).toThrow();
  });

  it('enforces pump safety policy and supports idempotent close', async () => {
    const runtime = new PinoutRuntime();
    const pump = await runtime.registerFromModule('pinout/pump', { id: 'pump', simulated: true });
    await expect(pump.invoke('pump.set', { speed: 101 })).rejects.toThrow();
    await pump.invoke('pump.set', { speed: 40 });
    expect((await pump.invoke('status.read')).status).toBe('running');
    await runtime.close();
    await runtime.close();
  });
});
