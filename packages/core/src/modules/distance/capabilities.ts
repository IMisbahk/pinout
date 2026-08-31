import type { CapabilityDescriptor } from '../../types.js';

export const distanceReadCapability: CapabilityDescriptor = {
  name: 'distance.read',
  description: 'Read a rangefinder distance in meters.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['meters'],
    properties: {
      meters: { type: 'number', description: 'Measured range in meters.' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const distanceStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read rangefinder operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'meters'],
    properties: {
      status: { type: 'string', enum: ['ready', 'faulted'] },
      meters: { type: 'number' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const distanceCapabilities = [distanceReadCapability, distanceStatusReadCapability] as const;

export const distanceCapabilityNames = distanceCapabilities.map((capability) => capability.name);
