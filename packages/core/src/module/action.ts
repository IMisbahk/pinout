import type { CapabilityDescriptor, CapabilitySafety, JsonSchema } from '../types.js';

export interface ActionInput {
  id: string;
  description: string;
  input?: JsonSchema;
  output?: JsonSchema;
  safety?: Partial<CapabilitySafety>;
}

const emptyObjectSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {},
};

const passthroughObjectSchema: JsonSchema = {
  type: 'object',
  additionalProperties: true,
};

const defaultSafety: CapabilitySafety = {
  physicalOutput: false,
  reversible: true,
};

/** Declare a capability with JSON Schema–compatible input/output definitions. */
export function action(input: ActionInput): CapabilityDescriptor {
  return {
    name: input.id,
    description: input.description,
    inputSchema: input.input ?? emptyObjectSchema,
    outputSchema: input.output ?? passthroughObjectSchema,
    safety: { ...defaultSafety, ...input.safety },
  };
}

/** Shorthand for sensor read capabilities with no input. */
export function sensorRead(
  id: string,
  description: string,
  output: JsonSchema,
): CapabilityDescriptor {
  return action({
    id,
    description,
    input: emptyObjectSchema,
    output,
    safety: { physicalOutput: false, reversible: true },
  });
}
