import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import {
  limitSwitchCapabilities,
  limitSwitchCapabilityNames,
} from './limitSwitch/capabilities.js';
import { createSimulatedLimitSwitchBackend } from './limitSwitch/simulator.js';

export const limitSwitchModuleId = 'pinout/limit-switch';

export const limitSwitchModule: PinoutModuleDefinition = {
  id: limitSwitchModuleId,
  version: '0.1.0',
  deviceClass: 'sensor.limit_switch',
  vendor: 'Pinout',
  model: 'Simulated Limit Switch',
  capabilities: [...limitSwitchCapabilities],
  capabilityNames: [...limitSwitchCapabilityNames],
  policies: [],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const triggered = options.triggered === true;
    return createSimulatedLimitSwitchBackend({ triggered });
  },
};
