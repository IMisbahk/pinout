import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { encoderCapabilities, encoderCapabilityNames } from './encoder/capabilities.js';
import { createSimulatedEncoderBackend } from './encoder/simulator.js';

export const encoderModuleId = 'pinout/encoder';

export const encoderModule: PinoutModuleDefinition = {
  id: encoderModuleId,
  version: '0.1.0',
  deviceClass: 'sensor.encoder',
  vendor: 'Pinout',
  model: 'Simulated Quadrature Encoder',
  capabilities: [...encoderCapabilities],
  capabilityNames: [...encoderCapabilityNames],
  policies: [],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const ticks = typeof options.ticks === 'number' ? options.ticks : 0;
    return createSimulatedEncoderBackend({ ticks });
  },
};
