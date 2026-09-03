import type { CapabilityDescriptor } from '../../types.js';

export const encoderReadCapability: CapabilityDescriptor = {
  name: 'encoder.read',
  description: 'Read quadrature encoder ticks from a home or reset origin.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['ticks'],
    properties: { ticks: { type: 'integer' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const encoderResetCapability: CapabilityDescriptor = {
  name: 'encoder.reset',
  description: 'Zero the encoder tick count.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['ticks'],
    properties: { ticks: { type: 'integer' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const encoderStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read encoder operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'ticks'],
    properties: {
      status: { type: 'string', enum: ['ready', 'faulted'] },
      ticks: { type: 'integer' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const encoderCapabilities = [
  encoderReadCapability,
  encoderResetCapability,
  encoderStatusReadCapability,
] as const;

export const encoderCapabilityNames = encoderCapabilities.map((capability) => capability.name);
