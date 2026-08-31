import type { CapabilityDescriptor } from './types.js';

const gpioPinSchema = {
  type: 'integer',
  description: 'GPIO pin number. Valid ranges are device-specific.',
  minimum: 0,
} as const;

export const gpioWriteCapability: CapabilityDescriptor = {
  name: 'gpio.write',
  description: 'Drive a GPIO pin high or low.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin', 'value'],
    properties: {
      pin: gpioPinSchema,
      value: {
        type: 'boolean',
        description: 'true for high, false for low.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: gpioPinSchema,
      value: { type: 'boolean' },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes:
      'Changes the electrical state of a pin. Invalid pins can crash firmware or damage hardware. Pinout cannot guarantee physical safety.',
  },
};

export const gpioReadCapability: CapabilityDescriptor = {
  name: 'gpio.read',
  description: 'Read the current level of a GPIO pin.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['pin'],
    properties: {
      pin: gpioPinSchema,
    },
  },
  outputSchema: {
    type: 'object',
    required: ['pin', 'value'],
    properties: {
      pin: gpioPinSchema,
      value: { type: 'boolean' },
    },
  },
  safety: {
    physicalOutput: false,
    reversible: true,
    notes:
      'Read-only. Does not change pin mode on input-only pins; output pins return the driven level.',
  },
};

export const sysHelloCapability: CapabilityDescriptor = {
  name: 'sys.hello',
  description: 'Handshake with the device and return firmware identity plus supported actions.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: {},
  },
  outputSchema: {
    type: 'object',
    required: ['firmware', 'version', 'protocol', 'capabilities'],
    properties: {
      firmware: { type: 'string' },
      version: { type: 'string' },
      protocol: { type: 'integer' },
      capabilities: { type: 'array', items: { type: 'string' } },
    },
  },
  safety: {
    physicalOutput: false,
    reversible: true,
  },
};

const catalog: Record<string, CapabilityDescriptor> = {
  [sysHelloCapability.name]: sysHelloCapability,
  [gpioWriteCapability.name]: gpioWriteCapability,
  [gpioReadCapability.name]: gpioReadCapability,
};

export function describeCapability(name: string): CapabilityDescriptor {
  return (
    catalog[name] ?? {
      name,
      description: `Device-reported action '${name}'.`,
      inputSchema: { type: 'object' },
      outputSchema: { type: 'object' },
      safety: {
        physicalOutput: true,
        reversible: false,
        notes: 'Unknown action. Treat as potentially unsafe until documented.',
      },
    }
  );
}

export function describeCapabilities(names: string[]): CapabilityDescriptor[] {
  return names.map(describeCapability);
}

export function toAgentTools(capabilities: CapabilityDescriptor[]) {
  return capabilities.map((capability) => ({
    name: capability.name,
    description: capability.description,
    inputSchema: capability.inputSchema,
    outputSchema: capability.outputSchema,
    annotations: capability.safety,
  }));
}
