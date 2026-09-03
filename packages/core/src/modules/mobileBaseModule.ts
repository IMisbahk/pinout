import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import {
  mobileBaseAngularPolicy,
  mobileBaseCapabilities,
  mobileBaseCapabilityNames,
  mobileBaseLinearPolicy,
} from './mobileBase/capabilities.js';
import { createSimulatedMobileBaseBackend } from './mobileBase/simulator.js';

export const mobileBaseModuleId = 'pinout/mobile-base';

export const mobileBaseModule: PinoutModuleDefinition = {
  id: mobileBaseModuleId,
  version: '0.1.0',
  deviceClass: 'robot.mobile_base',
  vendor: 'Pinout',
  model: 'Simulated Differential Drive',
  capabilities: [...mobileBaseCapabilities],
  capabilityNames: [...mobileBaseCapabilityNames],
  policies: [mobileBaseLinearPolicy, mobileBaseAngularPolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const integrationDt = typeof options.integrationDt === 'number' ? options.integrationDt : 0.1;
    return createSimulatedMobileBaseBackend({ integrationDt });
  },
};
