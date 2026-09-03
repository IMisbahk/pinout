import { describe, expect, it } from 'vitest';
import { ProtocolError, ValidationError } from '@pinout/core';
import { validateInputSchema, validateOutputSchema } from '../src/schema.js';
import { gpioBatchWriteCapability, gpioPulseCapability, gpioWriteCapability } from '@pinout/core';

describe('validateInputSchema', () => {
  it('accepts a valid gpio.write payload', () => {
    expect(validateInputSchema(gpioWriteCapability.inputSchema, { pin: 2, value: true })).toEqual({
      pin: 2,
      value: true,
    });
  });

  it('rejects missing required fields and extra keys', () => {
    expect(() => validateInputSchema(gpioWriteCapability.inputSchema, { pin: 2 })).toThrow(
      ValidationError,
    );
    expect(() =>
      validateInputSchema(gpioWriteCapability.inputSchema, { pin: 2, value: true, extra: 1 }),
    ).toThrow(ValidationError);
  });

  it('rejects out of range pulse duration', () => {
    expect(() =>
      validateInputSchema(gpioPulseCapability.inputSchema, { pin: 2, value: true, durationMs: 0 }),
    ).toThrow(ValidationError);
  });

  it('enforces array cardinality declared by capability schemas', () => {
    expect(() => validateInputSchema(gpioBatchWriteCapability.inputSchema, { writes: [] })).toThrow(
      ValidationError,
    );
    expect(() =>
      validateInputSchema(gpioBatchWriteCapability.inputSchema, {
        writes: Array.from({ length: 17 }, (_, pin) => ({ pin, value: false })),
      }),
    ).toThrow(ValidationError);
  });

  it('rejects malformed capability output as a protocol contract violation', () => {
    expect(() =>
      validateOutputSchema(gpioWriteCapability.outputSchema, { pin: 2, value: 'high' }),
    ).toThrow(ProtocolError);
  });
});
