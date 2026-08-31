import type { CapabilityDescriptor } from '../../types.js';

export const motorSetCapability: CapabilityDescriptor = {
  name: 'motor.set',
  description: 'Set DC motor speed. Negative values reverse direction.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['speed'],
    properties: {
      speed: {
        type: 'number',
        description: 'Normalized speed from -1 (full reverse) to 1 (full forward).',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['speed'],
    properties: { speed: { type: 'number' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Drives a rotating actuator. Set speed to 0 or call motor.stop to halt.',
  },
};

export const motorStopCapability: CapabilityDescriptor = {
  name: 'motor.stop',
  description: 'Stop the DC motor immediately.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['speed'],
    properties: { speed: { type: 'number' } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const motorReadCapability: CapabilityDescriptor = {
  name: 'motor.read',
  description: 'Read the current commanded motor speed.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['speed'],
    properties: { speed: { type: 'number' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const dcMotorStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read DC motor operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'speed'],
    properties: {
      status: { type: 'string', enum: ['ready', 'running', 'stopped', 'faulted'] },
      speed: { type: 'number' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const dcMotorCapabilities = [
  motorSetCapability,
  motorStopCapability,
  motorReadCapability,
  dcMotorStatusReadCapability,
] as const;

export const dcMotorCapabilityNames = dcMotorCapabilities.map((capability) => capability.name);

export const dcMotorSpeedPolicy = {
  kind: 'numericRange' as const,
  capability: 'motor.set',
  field: 'speed',
  min: -1,
  max: 1,
  message: 'Motor speed must be between -1 and 1.',
};
