import type { CapabilityDescriptor } from '../../types.js';

export const stepperStepCapability: CapabilityDescriptor = {
  name: 'stepper.step',
  description: 'Move the stepper a relative number of steps.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['steps'],
    properties: {
      steps: {
        type: 'integer',
        description: 'Relative steps. Negative values reverse direction.',
      },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['position'],
    properties: { position: { type: 'integer' } },
  },
  safety: {
    physicalOutput: true,
    reversible: true,
    notes: 'Commands open-loop steps. Missing home or skipped steps are not detected.',
  },
};

export const stepperGotoCapability: CapabilityDescriptor = {
  name: 'stepper.goto',
  description: 'Move the stepper to an absolute step position.',
  inputSchema: {
    type: 'object',
    additionalProperties: false,
    required: ['position'],
    properties: {
      position: { type: 'integer', description: 'Absolute step position from home.' },
    },
  },
  outputSchema: {
    type: 'object',
    required: ['position'],
    properties: { position: { type: 'integer' } },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const stepperHomeCapability: CapabilityDescriptor = {
  name: 'stepper.home',
  description: 'Return the stepper to the home position (step 0).',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['position', 'homed'],
    properties: {
      position: { type: 'integer' },
      homed: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const stepperStopCapability: CapabilityDescriptor = {
  name: 'stepper.stop',
  description: 'Stop any in-progress stepper motion.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'position'],
    properties: {
      status: { type: 'string', enum: ['stopped'] },
      position: { type: 'integer' },
    },
  },
  safety: { physicalOutput: true, reversible: true },
};

export const stepperReadCapability: CapabilityDescriptor = {
  name: 'stepper.read',
  description: 'Read the current stepper position.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['position', 'homed'],
    properties: {
      position: { type: 'integer' },
      homed: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const stepperStatusReadCapability: CapabilityDescriptor = {
  name: 'status.read',
  description: 'Read stepper operational status.',
  inputSchema: { type: 'object', additionalProperties: false, properties: {} },
  outputSchema: {
    type: 'object',
    required: ['status', 'position', 'homed'],
    properties: {
      status: { type: 'string', enum: ['ready', 'busy', 'stopped', 'faulted'] },
      position: { type: 'integer' },
      homed: { type: 'boolean' },
    },
  },
  safety: { physicalOutput: false, reversible: true },
};

export const stepperCapabilities = [
  stepperStepCapability,
  stepperGotoCapability,
  stepperHomeCapability,
  stepperStopCapability,
  stepperReadCapability,
  stepperStatusReadCapability,
] as const;

export const stepperCapabilityNames = stepperCapabilities.map((capability) => capability.name);

export const stepperStepPolicy = {
  kind: 'numericRange' as const,
  capability: 'stepper.step',
  field: 'steps',
  min: -100_000,
  max: 100_000,
  message: 'Relative step count must be between -100000 and 100000.',
};

export const stepperGotoPolicy = {
  kind: 'numericRange' as const,
  capability: 'stepper.goto',
  field: 'position',
  min: -100_000,
  max: 100_000,
  message: 'Absolute stepper position must be between -100000 and 100000.',
};
