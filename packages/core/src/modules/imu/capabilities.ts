import type { CapabilityDescriptor, JsonSchema } from '../../types.js';

const vectorSchema: JsonSchema = {
  type: 'object',
  required: ['x', 'y', 'z'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
  },
};

export const imuReadCapability: CapabilityDescriptor = {
  name: 'imu.read',
  description: 'Read accelerometer (g) and gyroscope (rad/s) samples.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['accel', 'gyro'],
    properties: { accel: vectorSchema, gyro: vectorSchema },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const imuStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read IMU operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'accel', 'gyro'],
    properties: {
      status: { type: 'string', enum: ['ready', 'faulted'] },
      accel: vectorSchema,
      gyro: vectorSchema,
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const imuCapabilities = [imuReadCapability, imuStatusReadCapability] as const;
export const imuCapabilityNames = imuCapabilities.map((capability) => capability.name);
