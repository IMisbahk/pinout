/**
 * Multi-driver fluid rig — one governed device surface across two independent drivers.
 *
 *   npm run demo:composite
 */
import {
  PinoutRuntime,
  createCompositeDevice,
  createSimulatedPumpBackend,
  createSimulatedRelayBackend,
  pumpModule,
  relayModule,
} from '@pinout/core';

const pumpCapabilities = pumpModule.capabilities;
const relayCapabilities = relayModule.capabilities.filter(
  (capability) => capability.name !== 'status.read',
);

const rig = createCompositeDevice({
  id: 'fluid-rig-01',
  moduleId: 'example/fluid-rig',
  deviceClass: 'system.fluid_rig',
  label: 'Simulated multi-driver fluid rig',
  drivers: {
    pump: createSimulatedPumpBackend(),
    contactor: createSimulatedRelayBackend(),
  },
  capabilities: [...pumpCapabilities, ...relayCapabilities],
  policies: pumpModule.policies,
  routes: {
    'pump.set': { driver: 'pump' },
    'pump.stop': { driver: 'pump' },
    'pump.read': { driver: 'pump' },
    'status.read': { driver: 'pump' },
    'relay.set': { driver: 'contactor' },
    'relay.read': { driver: 'contactor' },
  },
});

const runtime = new PinoutRuntime();
runtime.on((event) => {
  console.log(`[event] ${event.deviceId} ${event.event} driver=${String(event.payload.driver)}`);
});
await runtime.register(rig);

console.log('=== Pinout multi-driver rig (SIMULATION) ===');
console.log(JSON.stringify(rig.identity, null, 2));
console.log(`capabilities: ${rig.capabilityNames().join(', ')}`);

await runtime.invoke(rig.id, 'relay.set', { on: true });
await runtime.invoke(rig.id, 'pump.set', { speed: 35 });
console.log(`state: ${JSON.stringify(rig.getOperationalStateSnapshot())}`);

await runtime.invoke(rig.id, 'pump.stop', {});
await runtime.invoke(rig.id, 'relay.set', { on: false });
console.log(`safe state: ${JSON.stringify(rig.getOperationalStateSnapshot())}`);

await runtime.close();
