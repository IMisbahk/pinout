import type { CapabilityDescriptor } from '../../types.js';

export const driveSetVelocityCapability: CapabilityDescriptor = {
  name: 'drive.set_velocity',
  description: 'Command linear and angular velocity for a differential-drive base.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['linear', 'angular'],
    properties: {
      linear: { type: 'number', description: 'Forward velocity in meters per second.' },
      angular: { type: 'number', description: 'Yaw rate in radians per second.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['linear', 'angular'],
    properties: {
      linear: { type: 'number' },
      angular: { type: 'number' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Moves the robot through space. Call drive.stop to halt.',
  },
};

export const driveStopCapability: CapabilityDescriptor = {
  name: 'drive.stop',
  description: 'Stop the mobile base immediately.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['linear', 'angular'],
    properties: {
      linear: { type: 'number' },
      angular: { type: 'number' },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const drivePoseReadCapability: CapabilityDescriptor = {
  name: 'pose.read',
  description: 'Read simulated odometry for the mobile base.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['x', 'y', 'heading'],
    properties: {
      x: { type: 'number' },
      y: { type: 'number' },
      heading: { type: 'number', description: 'Yaw in radians.' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const mobileBaseStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read mobile base operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'linear', 'angular', 'x', 'y', 'heading'],
    properties: {
      status: { type: 'string', enum: ['ready', 'moving', 'stopped', 'faulted'] },
      linear: { type: 'number' },
      angular: { type: 'number' },
      x: { type: 'number' },
      y: { type: 'number' },
      heading: { type: 'number' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const mobileBaseCapabilities = [
  driveSetVelocityCapability,
  driveStopCapability,
  drivePoseReadCapability,
  mobileBaseStatusReadCapability,
] as const;

export const mobileBaseCapabilityNames = mobileBaseCapabilities.map(
  (capability) => capability.name,
);

export const mobileBaseLinearPolicy = {
  kind: 'numericRange' as const,
  capability: 'drive.set_velocity',
  field: 'linear',
  min: -1.5,
  max: 1.5,
  message: 'Linear velocity must be between -1.5 and 1.5 m/s.',
};

export const mobileBaseAngularPolicy = {
  kind: 'numericRange' as const,
  capability: 'drive.set_velocity',
  field: 'angular',
  min: -3,
  max: 3,
  message: 'Angular velocity must be between -3 and 3 rad/s.',
};
