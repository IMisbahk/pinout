import type { CapabilityDescriptor } from '../../types.js';

export const limitReadCapability: CapabilityDescriptor = {
  name: 'limit.read',
  description: 'Read whether a limit or end-stop switch is triggered.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['triggered'],
    properties: { triggered: { type: 'boolean' } },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const limitStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read limit-switch operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'triggered'],
    properties: {
      status: { type: 'string', enum: ['ready', 'faulted'] },
      triggered: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const limitSwitchCapabilities = [limitReadCapability, limitStatusReadCapability] as const;
export const limitSwitchCapabilityNames = limitSwitchCapabilities.map(
  (capability) => capability.name,
);
