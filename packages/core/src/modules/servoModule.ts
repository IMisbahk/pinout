import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { servoAnglePolicy, servoCapabilities, servoCapabilityNames } from './servo/capabilities.js';
import { createSimulatedServoBackend } from './servo/simulator.js';

export const servoModuleId = 'pinout/servo';

export const servoModule: PinoutModuleDefinition = {
  id: servoModuleId,
  version: '0.1.0',
  deviceClass: 'actuator.servo',
  vendor: 'Pinout',
  model: 'Simulated Hobby Servo',
  capabilities: [...servoCapabilities],
  capabilityNames: [...servoCapabilityNames],
  policies: [servoAnglePolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(): DeviceBackend {
    return createSimulatedServoBackend();
  },
};
