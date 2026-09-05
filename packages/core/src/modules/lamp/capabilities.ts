import type { CapabilityDescriptor } from '../../types.js';

export const lampArmCapability: CapabilityDescriptor = {
  name: 'lamp.arm',
  description:
    'Explicitly arm the lamp for physical actuation and configure/kick the host-loss watchdog.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      timeoutMs: {
        type: 'integer',
        minimum: 1,
        description: 'Watchdog timeout in milliseconds.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['armed'],
    properties: {
      armed: { type: 'string', enum: ['armed'] },
      timeoutMs: { type: 'integer', minimum: 0 },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes:
      'Transitions lamp into armed state allowing physical actuation. Requires host-loss watchdog.',
  },
};

export const lampDisarmCapability: CapabilityDescriptor = {
  name: 'lamp.disarm',
  description:
    'Disarm the lamp, stop the watchdog timer, and apply the commissioned safe level immediately.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  outputSchema: {
    type: 'object',
    required: ['armed'],
    properties: {
      armed: { type: 'string', enum: ['disarmed'] },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Disarms the lamp and enforces the commissioned safe level.',
  },
};

export const lampOnCapability: CapabilityDescriptor = {
  name: 'lamp.on',
  description: 'Turn the lamp on (energize output).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      validityMs: {
        type: 'integer',
        minimum: 1,
        description: 'Command validity TTL in milliseconds.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['on'],
    properties: { on: { type: 'boolean' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Energizes the lamp output. Requires armed device and active deadman watchdog.',
  },
};

export const lampOffCapability: CapabilityDescriptor = {
  name: 'lamp.off',
  description: 'Turn the lamp off (de-energize output).',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {
      validityMs: {
        type: 'integer',
        minimum: 1,
        description: 'Command validity TTL in milliseconds.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['on'],
    properties: { on: { type: 'boolean' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'De-energizes the lamp output.',
  },
};

export const lampSetCapability: CapabilityDescriptor = {
  name: 'lamp.set',
  description: 'Set the lamp state directly.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['on'],
    properties: {
      on: { type: 'boolean', description: 'true to energize, false to de-energize.' },
      validityMs: {
        type: 'integer',
        minimum: 1,
        description: 'Command validity TTL in milliseconds.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['on'],
    properties: { on: { type: 'boolean' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Sets the lamp output state. Requires armed device.',
  },
};

export const lampStatusCapability: CapabilityDescriptor = {
  name: 'lamp.status',
  description: 'Read lamp operational state and multi-stage evidence model.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  outputSchema: {
    type: 'object',
    required: ['commanded', 'acknowledged', 'observed', 'provenance', 'armed'],
    properties: {
      commanded: {
        type: 'object',
        properties: {
          on: { description: 'Commanded on-state boolean, or null if uncommanded.' },
          at: { description: 'ISO timestamp of command, or null.' },
        },
      },
      acknowledged: {
        type: 'object',
        properties: {
          on: { description: 'Acknowledged on-state boolean, or null if unacknowledged.' },
          at: { description: 'ISO timestamp of acknowledgment, or null.' },
        },
      },
      observed: {
        type: 'object',
        required: ['source'],
        properties: {
          on: { description: 'Observed on-state boolean from independent readback, or null.' },
          at: { description: 'ISO timestamp of observation, or null.' },
          source: { type: 'string', enum: ['gpio-readback', 'none', 'simulated'] },
        },
      },
      freshnessMs: { description: 'Age of observation in milliseconds, or null.' },
      provenance: { type: 'string', enum: ['simulated', 'hardware'] },
      armed: { type: 'string', enum: ['armed', 'disarmed', 'tripped', 'unknown'] },
    },
  },
  safety: {
    physicalOutput: false,
    reversible: true,
    notes: 'Read-only query of commanded, acknowledged, and observed lamp state.',
  },
};

export const lampStatusReadCapability: CapabilityDescriptor = {
  ...lampStatusCapability,
  name: 'status.read',
  description: 'Generic status read alias for lamp operational state.',
};

export const lampCapabilities = [
  lampArmCapability,
  lampDisarmCapability,
  lampOnCapability,
  lampOffCapability,
  lampSetCapability,
  lampStatusCapability,
  lampStatusReadCapability,
] as const;

export const lampCapabilityNames = lampCapabilities.map((capability) => capability.name);
