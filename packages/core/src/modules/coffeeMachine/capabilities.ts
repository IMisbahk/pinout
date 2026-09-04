import type { CapabilityDescriptor } from '../../types.js';

const empty = { type: 'object' as const, additionalProperties: false, properties: {} };
const state = { type: 'string' as const, enum: ['ok', 'low'] };

export const waterLevelReadCapability: CapabilityDescriptor = {
  name: 'water_level.read',
  description: 'Read the coffee machine water level state.',
  inputSchema: empty,
  outputSchema: { type: 'object', required: ['state'], properties: { state } },
  safety: { physicalOutput: false, reversible: true },
};
export const temperatureReadCapability: CapabilityDescriptor = {
  name: 'temperature.read',
  description: 'Read boiler temperature in degrees Celsius.',
  inputSchema: empty,
  outputSchema: {
    type: 'object',
    required: ['temperature'],
    properties: { temperature: { type: 'number' } },
  },
  safety: { physicalOutput: false, reversible: true },
};
export const heaterSetCapability: CapabilityDescriptor = {
  name: 'heater.set',
  description: 'Enable or disable the boiler heater.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['enabled'],
    properties: { enabled: { type: 'boolean' } },
  },
  outputSchema: {
    type: 'object',
    required: ['enabled'],
    properties: { enabled: { type: 'boolean' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'HIGH_RISK: requires operator approval and an adequate water-level interlock.',
  },
};
export const pumpStartCapability: CapabilityDescriptor = {
  name: 'pump.start',
  description: 'Start the brew pump.',
  inputSchema: empty,
  outputSchema: {
    type: 'object',
    required: ['pump'],
    properties: { pump: { type: 'string', enum: ['running'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};
export const pumpStopCapability: CapabilityDescriptor = {
  name: 'pump.stop',
  description: 'Stop the brew pump.',
  inputSchema: empty,
  outputSchema: {
    type: 'object',
    required: ['pump'],
    properties: { pump: { type: 'string', enum: ['off'] } },
  },
  safety: { physicalOutput: true, reversible: true },
};
export const brewStartCapability: CapabilityDescriptor = {
  name: 'brew.start',
  description: 'Start a bounded, cancellable brew operation.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    properties: { shots: { type: 'number', minimum: 1, maximum: 4 } },
  },
  outputSchema: {
    type: 'object',
    required: ['status', 'progress'],
    properties: {
      status: { type: 'string', enum: ['brewing'] },
      progress: { type: 'number', minimum: 0, maximum: 1 },
    },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Long-running operation; caller must supply a deadline and idempotency key.',
  },
};
export const brewStopCapability: CapabilityDescriptor = {
  name: 'brew.stop',
  description: 'Cooperatively stop the current brew and leave outputs off.',
  inputSchema: empty,
  outputSchema: {
    type: 'object',
    required: ['status', 'pump', 'heater'],
    properties: {
      status: { type: 'string', enum: ['cancelled', 'idle'] },
      pump: { type: 'string', enum: ['off'] },
      heater: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};
export const coffeeStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read coffee-machine operational state.',
  inputSchema: empty,
  outputSchema: {
    type: 'object',
    required: ['status', 'water_level', 'temperature', 'heater', 'pump', 'brew'],
    properties: {
      status: { type: 'string', enum: ['ready', 'brewing', 'faulted'] },
      water_level: { type: 'object' },
      temperature: { type: 'number' },
      heater: { type: 'boolean' },
      pump: { type: 'string' },
      brew: { type: 'object' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};
export const coffeeMachineCapabilities = [
  waterLevelReadCapability,
  temperatureReadCapability,
  heaterSetCapability,
  pumpStartCapability,
  pumpStopCapability,
  brewStartCapability,
  brewStopCapability,
  coffeeStatusReadCapability,
] as const;
export const coffeeMachineCapabilityNames = coffeeMachineCapabilities.map((c) => c.name);
