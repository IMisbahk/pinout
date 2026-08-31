import type { CapabilityDescriptor } from '../../types.js';

export const temperatureReadCapability: CapabilityDescriptor = {
  name: 'temperature.read',
  description: 'Read the current chamber temperature in Celsius.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['temperature', 'targetTemperature'],
    properties: {
      temperature: { type: 'number' },
      targetTemperature: { type: 'number' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const temperatureSetCapability: CapabilityDescriptor = {
  name: 'temperature.set',
  description: 'Set the chamber target temperature in Celsius.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['value'],
    properties: {
      value: { type: 'number', description: 'Target temperature in °C.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['targetTemperature'],
    properties: { targetTemperature: { type: 'number' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Heating or cooling a physical chamber.',
  },
};

export const doorOpenCapability: CapabilityDescriptor = {
  name: 'door.open',
  description: 'Open the chamber door.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['door'],
    properties: { door: { type: 'string', enum: ['open'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const doorCloseCapability: CapabilityDescriptor = {
  name: 'door.close',
  description: 'Close the chamber door.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['door'],
    properties: { door: { type: 'string', enum: ['closed'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const experimentStartCapability: CapabilityDescriptor = {
  name: 'experiment.start',
  description: 'Start a chamber experiment at the current target temperature.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['experiment'],
    properties: { experiment: { type: 'string', enum: ['running'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const experimentStopCapability: CapabilityDescriptor = {
  name: 'experiment.stop',
  description: 'Stop the running experiment.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['experiment'],
    properties: { experiment: { type: 'string', enum: ['idle'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const chamberStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read chamber operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'temperature', 'targetTemperature', 'door', 'experiment'],
    properties: {
      status: { type: 'string', enum: ['ready', 'busy', 'faulted'] },
      temperature: { type: 'number' },
      targetTemperature: { type: 'number' },
      door: { type: 'string', enum: ['open', 'closed'] },
      experiment: { type: 'string', enum: ['idle', 'running'] },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const chamberCapabilities = [
  temperatureReadCapability,
  temperatureSetCapability,
  doorOpenCapability,
  doorCloseCapability,
  experimentStartCapability,
  experimentStopCapability,
  chamberStatusReadCapability,
] as const;

export const chamberCapabilityNames = chamberCapabilities.map((capability) => capability.name);

export const chamberTemperaturePolicy = {
  kind: 'numericRange' as const,
  capability: 'temperature.set',
  field: 'value',
  min: 10,
  max: 80,
  message: 'Target temperature must be between 10°C and 80°C.',
};

export const chamberExperimentStartPolicy = {
  kind: 'stateEquals' as const,
  capability: 'experiment.start',
  field: 'door',
  equals: 'closed',
  message: 'experiment.start requires the chamber door to be closed.',
};
