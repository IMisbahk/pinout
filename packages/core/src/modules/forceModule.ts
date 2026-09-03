import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { forceCapabilities, forceCapabilityNames } from './force/capabilities.js';
import { createSimulatedForceBackend } from './force/simulator.js';

export const forceModuleId = 'pinout/force';

export const forceModule: PinoutModuleDefinition = {
  id: forceModuleId,
  version: '0.1.0',
  deviceClass: 'sensor.force',
  vendor: 'Pinout',
  model: 'Simulated Force Sensor',
  capabilities: [...forceCapabilities],
  capabilityNames: [...forceCapabilityNames],
  policies: [],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const newtons = typeof options.newtons === 'number' ? options.newtons : 0;
    return createSimulatedForceBackend({ newtons });
  },
};
