import type { CapabilityDescriptor } from '../../types.js';

export const servoSetAngleCapability: CapabilityDescriptor = {
  name: 'servo.set_angle',
  description: 'Move a hobby servo to an angle in degrees.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['angle'],
    properties: {
      angle: {
        type: 'number',
        description: 'Target angle in degrees (0–180).',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['angle'],
    properties: { angle: { type: 'number' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Moves a physical servo horn. Stay within mechanical limits of the linkage.',
  },
};

export const servoReadCapability: CapabilityDescriptor = {
  name: 'servo.read',
  description: 'Read the commanded servo angle.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['angle'],
    properties: { angle: { type: 'number' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const servoStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read servo operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'angle'],
    properties: {
      status: { type: 'string', enum: ['ready', 'moving', 'faulted'] },
      angle: { type: 'number' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const servoCapabilities = [
  servoSetAngleCapability,
  servoReadCapability,
  servoStatusReadCapability,
] as const;

export const servoCapabilityNames = servoCapabilities.map((capability) => capability.name);

export const servoAnglePolicy = {
  kind: 'numericRange' as const,
  capability: 'servo.set_angle',
  field: 'angle',
  min: 0,
  max: 180,
  message: 'Servo angle must be between 0 and 180 degrees.',
};
