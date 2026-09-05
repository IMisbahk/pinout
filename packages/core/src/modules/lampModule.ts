import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { lampCapabilities, lampCapabilityNames } from './lamp/capabilities.js';
import { createSimulatedLampBackend, SimulatedLampBackend } from './lamp/simulator.js';
import { createEsp32LampBackend, Esp32LampBackend } from './lamp/esp32Backend.js';
import { validateLampConfig } from './lamp/types.js';

export const lampModuleId = 'pinout/lamp';

export const lampModule: PinoutModuleDefinition = {
  id: lampModuleId,
  version: '0.1.0',
  deviceClass: 'actuator.lamp',
  vendor: 'Pinout',
  model: 'Commissioned Lamp',
  capabilities: [...lampCapabilities],
  capabilityNames: [...lampCapabilityNames],
  policies: [],
  supportedTransportKinds: ['simulated', 'serial', 'tcp', 'simulated-esp32', 'loopback'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    return createSimulatedLampBackend(options);
  },
  async createProtocolBackend(options: Record<string, unknown> = {}): Promise<DeviceBackend> {
    return createEsp32LampBackend(options);
  },
};

export {
  createSimulatedLampBackend,
  createEsp32LampBackend,
  SimulatedLampBackend,
  Esp32LampBackend,
  validateLampConfig,
  lampCapabilities,
  lampCapabilityNames,
};
export type {
  LampConfig,
  ValidatedLampConfig,
  LampStatus,
  LampPolarity,
  LampSafeLevel,
  LampArmedState,
  LampObservedSource,
  LampCommandedState,
  LampAcknowledgedState,
  LampObservedState,
} from './lamp/types.js';
