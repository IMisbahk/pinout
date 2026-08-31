import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import {
  stepperCapabilities,
  stepperCapabilityNames,
  stepperGotoPolicy,
  stepperStepPolicy,
} from './stepper/capabilities.js';
import { createSimulatedStepperBackend } from './stepper/simulator.js';

export const stepperModuleId = 'pinout/stepper';

export const stepperModule: PinoutModuleDefinition = {
  id: stepperModuleId,
  version: '0.1.0',
  deviceClass: 'actuator.stepper',
  vendor: 'Pinout',
  model: 'Simulated Stepper Motor',
  capabilities: [...stepperCapabilities],
  capabilityNames: [...stepperCapabilityNames],
  policies: [stepperStepPolicy, stepperGotoPolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(): DeviceBackend {
    return createSimulatedStepperBackend();
  },
};
