import type { DeviceBackend, PinoutModuleDefinition } from '../runtime/types.js';
import { imuCapabilities, imuCapabilityNames } from './imu/capabilities.js';
import { createSimulatedImuBackend } from './imu/simulator.js';

export const imuModuleId = 'pinout/imu';

export const imuModule: PinoutModuleDefinition = {
  id: imuModuleId,
  version: '0.1.0',
  deviceClass: 'sensor.imu',
  vendor: 'Pinout',
  model: 'Simulated IMU',
  capabilities: [...imuCapabilities],
  capabilityNames: [...imuCapabilityNames],
  policies: [],
  supportedTransportKinds: ['simulated'],
  createSimulatedBackend(): DeviceBackend {
    return createSimulatedImuBackend();
  },
};
