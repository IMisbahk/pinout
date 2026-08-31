import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import {
  robotArmCapabilities,
  robotArmCapabilityNames,
  robotArmWorkspacePolicy,
} from './robotArm/capabilities.js';
import { createSimulatedRobotArmBackend } from './robotArm/simulator.js';

export const robotArmModuleId = 'pinout/robot-arm';

export const robotArmModule: PinoutModuleDefinition = {
  id: robotArmModuleId,
  version: '0.1.0',
  deviceClass: 'robot.manipulator',
  vendor: 'Pinout',
  model: 'Simulated Manipulator',
  capabilities: [...robotArmCapabilities],
  capabilityNames: [...robotArmCapabilityNames],
  policies: [robotArmWorkspacePolicy],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(options: Record<string, unknown> = {}): DeviceBackend {
    const motionDelayMs = typeof options.motionDelayMs === 'number' ? options.motionDelayMs : 5;
    return createSimulatedRobotArmBackend({ motionDelayMs });
  },
};
