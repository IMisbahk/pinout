import { ValidationError } from './errors.js';
import type { JsonSchema } from './types.js';

export function validateInputSchema(
  schema: JsonSchema,
  value: unknown,
  path = '',
): Record<string, unknown> {
  assertSchema(schema, value, path || 'payload');
  if (!isPlainObject(value)) {
    throw new ValidationError('payload must be an object.');
  }
  return value;
}

function assertSchema(schema: JsonSchema, value: unknown, path: string): void {
  if (schema.type === 'object') {
    if (!isPlainObject(value)) {
      throw new ValidationError(`${path} must be an object.`);
    }
    const required = schema.required ?? [];
    for (const key of required) {
      if (!(key in value)) {
        throw new ValidationError(`${path} is missing required field '${key}'.`);
      }
    }
    const properties = schema.properties ?? {};
    for (const [key, child] of Object.entries(value)) {
      const childSchema = properties[key];
      if (!childSchema) {
        if (schema.additionalProperties === false) {
          throw new ValidationError(`${path} has unexpected field '${key}'.`);
        }
        continue;
      }
      assertSchema(childSchema, child, path ? `${path}.${key}` : key);
    }
    return;
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      throw new ValidationError(`${path} must be an array.`);
    }
    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        assertSchema(schema.items, value[index], `${path}[${index}]`);
      }
    }
    return;
  }

  if (schema.type === 'integer') {
    if (typeof value !== 'number' || !Number.isInteger(value)) {
      throw new ValidationError(`${path} must be an integer.`);
    }
    assertNumericBounds(schema, value, path);
    return;
  }

  if (schema.type === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new ValidationError(`${path} must be a number.`);
    }
    assertNumericBounds(schema, value, path);
    return;
  }

  if (schema.type === 'boolean') {
    if (typeof value !== 'boolean') {
      throw new ValidationError(`${path} must be a boolean.`);
    }
    return;
  }

  if (schema.type === 'string') {
    if (typeof value !== 'string') {
      throw new ValidationError(`${path} must be a string.`);
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      throw new ValidationError(`${path} is shorter than ${schema.minLength}.`);
    }
  }

  if (schema.enum && !schema.enum.includes(value as string | number | boolean)) {
    throw new ValidationError(`${path} must be one of: ${schema.enum.join(', ')}.`);
  }
}

function assertNumericBounds(schema: JsonSchema, value: number, path: string): void {
  if (schema.minimum !== undefined && value < schema.minimum) {
    throw new ValidationError(`${path} must be >= ${schema.minimum}.`);
  }
  if (schema.maximum !== undefined && value > schema.maximum) {
    throw new ValidationError(`${path} must be <= ${schema.maximum}.`);
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
