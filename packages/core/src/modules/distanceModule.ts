import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { distanceCapabilities, distanceCapabilityNames } from './distance/capabilities.js';
import { createSimulatedDistanceBackend } from './distance/simulator.js';

export const distanceModuleId = 'pinout/distance';

export const distanceModule: PinoutModuleDefinition = {
  id: distanceModuleId,
  version: '0.1.0',
  deviceClass: 'sensor.distance',
  vendor: 'Pinout',
  model: 'Simulated Rangefinder',
  capabilities: [...distanceCapabilities],
  capabilityNames: [...distanceCapabilityNames],
  policies: [],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const meters = typeof options.meters === 'number' ? options.meters : 0.5;
    return createSimulatedDistanceBackend({ meters });
  },
};
