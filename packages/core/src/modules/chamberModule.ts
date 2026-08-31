import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import {
  chamberCapabilities,
  chamberCapabilityNames,
  chamberExperimentStartPolicy,
  chamberTemperaturePolicy,
} from './chamber/capabilities.js';
import { createSimulatedChamberBackend } from './chamber/simulator.js';

export const chamberModuleId = 'pinout/environmental-chamber';

export const chamberModule: PinoutModuleDefinition = {
  id: chamberModuleId,
  version: '0.1.0',
  deviceClass: 'lab.environmental_chamber',
  vendor: 'Pinout',
  model: 'Simulated Environmental Chamber',
  capabilities: [...chamberCapabilities],
  capabilityNames: [...chamberCapabilityNames],
  policies: [chamberTemperaturePolicy, chamberExperimentStartPolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(): DeviceBackend {
    return createSimulatedChamberBackend();
  },
};
