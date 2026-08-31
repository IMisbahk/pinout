import { describe, expect, it } from 'vitest';
import { ValidationError } from '@pinout/core';
import { validateInputSchema } from '../src/schema.js';
import { gpioWriteCapability, gpioPulseCapability } from '@pinout/core';

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
});
