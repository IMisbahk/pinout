import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import {
  dcMotorCapabilities,
  dcMotorCapabilityNames,
  dcMotorSpeedPolicy,
} from './dcMotor/capabilities.js';
import { createSimulatedDcMotorBackend } from './dcMotor/simulator.js';

export const dcMotorModuleId = 'pinout/dc-motor';

export const dcMotorModule: PinoutModuleDefinition = {
  id: dcMotorModuleId,
  version: '0.1.0',
  deviceClass: 'actuator.dc_motor',
  vendor: 'Pinout',
  model: 'Simulated DC Motor',
  capabilities: [...dcMotorCapabilities],
  capabilityNames: [...dcMotorCapabilityNames],
  policies: [dcMotorSpeedPolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(): DeviceBackend {
    return createSimulatedDcMotorBackend();
  },
};
