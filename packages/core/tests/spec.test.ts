import { describe, expect, it } from 'vitest';
import {
  SPEC_VERSION,
  isCompatibleSpecVersion,
  convert,
  toCanonical,
  isKnownUnit,
  DANGER_LEVELS,
  requiresLease,
} from '../src/spec/index.js';

describe('spec version', () => {
  it('declares a major-compatible version', () => {
    expect(isCompatibleSpecVersion(SPEC_VERSION)).toBe(true);
    expect(isCompatibleSpecVersion('2.0')).toBe(false);
    expect(isCompatibleSpecVersion(undefined)).toBe(false);
    expect(isCompatibleSpecVersion('')).toBe(false);
  });
});

describe('unit conversions', () => {
  it('is identity for same units', () => {
    expect(convert(42, 'm', 'm')).toBe(42);
  });

  it('converts length linearly', () => {
    expect(convert(1, 'm', 'mm')).toBeCloseTo(1000);
    expect(convert(1000, 'mm', 'm')).toBeCloseTo(1);
    expect(convert(2.5, 'cm', 'm')).toBeCloseTo(0.025);
  });

  it('converts degrees and radians', () => {
    expect(convert(180, 'deg', 'rad')).toBeCloseTo(Math.PI);
    expect(convert(Math.PI / 2, 'rad', 'deg')).toBeCloseTo(90);
    expect(convert(60, 'rpm', 'rad/s')).toBeCloseTo(2 * Math.PI);
  });

  it('pivots temperature through kelvin', () => {
    expect(convert(0, 'C', 'K')).toBeCloseTo(273.15);
    expect(convert(100, 'C', 'F')).toBeCloseTo(212);
    expect(convert(32, 'F', 'C')).toBeCloseTo(0);
  });

  it('refuses ambiguous conversions instead of guessing', () => {
    expect(() => convert(50, 'percent', 'V')).toThrow(/No deterministic/);
    expect(() => convert(5, 'N', 'deg')).toThrow(/No deterministic/);
  });

  it('canonicalizes toward base units', () => {
    expect(toCanonical(1000, 'mm')).toEqual({ value: 1, unit: 'm' });
    expect(toCanonical(90, 'deg').unit).toBe('rad');
    expect(toCanonical(5, 'V')).toEqual({ value: 5, unit: 'V' });
  });

  it('recognizes known units', () => {
    expect(isKnownUnit('rad/s')).toBe(true);
    expect(isKnownUnit('furlongs')).toBe(false);
  });
});

describe('danger classification', () => {
  it('orders danger levels by rank', () => {
    expect(DANGER_LEVELS).toEqual([
      'READ_ONLY', 'LOW_RISK', 'PHYSICAL_SIDE_EFFECT', 'HIGH_RISK',
    ]);
    expect(requiresLease('READ_ONLY')).toBe(false);
    expect(requiresLease('HIGH_RISK')).toBe(true);
    expect(requiresLease('LOW_RISK', 'LOW_RISK')).toBe(true);
  });
});

describe('structured errors', () => {
  it('serializes with category and retryability', async () => {
    const { PinoutStructuredError, toStructuredError } = await import('../src/errors.js');
    const err = new PinoutStructuredError('LEASE_CONFLICT', 'LEASE', 'device is leased', {
      device: 'arm-01',
      capability: 'motion.move_to',
    });
    const json = err.toJSON();
    expect(json.category).toBe('LEASE');
    expect(json.retryable).toBe(false);
    expect(json.device).toBe('arm-01');

    const wrapped = toStructuredError(new Error('boom'), { device: 'arm-01' });
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(wrapped.device).toBe('arm-01');
  });

  it('classifies legacy codes into categories', async () => {
    const { toStructuredError } = await import('../src/errors.js');
    const { PolicyActionDenied } = await import('../src/policy/errors.js');
    const { TimeoutError, DisconnectedError } = await import('../src/errors.js');
    expect(toStructuredError(new PolicyActionDenied('nope')).category).toBe('POLICY');
    expect(toStructuredError(new TimeoutError()).code).toBe('TIMEOUT');
    expect(toStructuredError(new DisconnectedError()).category).toBe('TRANSPORT');
  });
});
