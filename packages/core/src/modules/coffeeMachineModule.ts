import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import type { PolicyContext } from '../policy/types.js';
import { PolicyPreconditionFailed } from '../policy/errors.js';
import type { SafetyRule } from '../policy/safety.js';
import {
  coffeeMachineCapabilities,
  coffeeMachineCapabilityNames,
} from './coffeeMachine/capabilities.js';
import { createSimulatedCoffeeMachineBackend } from './coffeeMachine/simulator.js';

export const coffeeMachineModuleId = 'pinout/coffee-machine';
const waterInterlock = {
  kind: 'custom' as const,
  capability: 'heater.set',
  evaluate: (context: PolicyContext) => {
    if (
      context.payload.enabled === true &&
      (context.operationalState.water_level as { state?: unknown } | undefined)?.state !== 'ok'
    )
      throw new PolicyPreconditionFailed('heater.set requires water_level.state == ok.', {
        deviceId: context.deviceId,
        capability: context.capability,
      });
  },
};
/** Recommended v2 governance rules for deployments that use SafetyEngine. */
export const coffeeMachineSafetyRules: SafetyRule[] = [
  { kind: 'lease', capability: 'brew.start', message: 'brew.start requires an exclusive lease.' },
  {
    kind: 'rate',
    capability: 'brew.start',
    maxPerWindow: 1,
    windowMs: 60_000,
    message: 'Only one brew may start per minute.',
  },
  {
    kind: 'resource',
    capability: 'pump.start',
    resource: 'pump-seconds',
    cost: 1,
    message: 'Pump run budget exceeded.',
  },
  { kind: 'approval', capability: 'heater.set', message: 'heater.set requires operator approval.' },
];
export const coffeeMachineModule: PinoutModuleDefinition = {
  id: coffeeMachineModuleId,
  version: '0.1.0',
  deviceClass: 'appliance.coffee_machine',
  vendor: 'Pinout',
  model: 'Simulated Coffee Machine',
  capabilities: [...coffeeMachineCapabilities],
  capabilityNames: [...coffeeMachineCapabilityNames],
  policies: [waterInterlock],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options = {}): DeviceBackend {
    return createSimulatedCoffeeMachineBackend(options);
  },
};
