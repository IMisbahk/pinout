import type { CapabilityDescriptor } from '../../types.js';

export const forceReadCapability: CapabilityDescriptor = {
  name: 'force.read',
  description: 'Read a force/load-cell sample in newtons.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['newtons'],
    properties: { newtons: { type: 'number' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const forceStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read force sensor operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'newtons'],
    properties: {
      status: { type: 'string', enum: ['ready', 'faulted'] },
      newtons: { type: 'number' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const forceCapabilities = [forceReadCapability, forceStatusReadCapability] as const;
export const forceCapabilityNames = forceCapabilities.map((capability) => capability.name);
