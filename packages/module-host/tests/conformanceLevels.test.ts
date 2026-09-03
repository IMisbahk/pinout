import { describe, expect, it } from 'vitest';
import {
  CONFORMANCE_LEVELS,
  LEVEL_NAMES,
  evaluateConformanceLevel,
  conformanceRecord,
  type ConformanceEvidence,
} from '../src/index.js';

const full: ConformanceEvidence = {
  manifestValid: true,
  builds: true,
  conformancePassed: true,
  simulationVerified: true,
  integrationVerified: true,
};

describe('conformance levels', () => {
  it('requires each rung in order — nothing is verified merely because tests mocked it', () => {
    expect(evaluateConformanceLevel({ ...full, builds: false })).toBe('L0');
    expect(evaluateConformanceLevel({ ...full, conformancePassed: false })).toBe('L1');
    expect(evaluateConformanceLevel({ ...full, simulationVerified: false })).toBe('L2');
    expect(evaluateConformanceLevel({ ...full, integrationVerified: false })).toBe('L3');
    expect(evaluateConformanceLevel(full)).toBe('L4');
    expect(
      evaluateConformanceLevel({
        ...full,
        hardwareRecord: {
          date: '2026-09-02',
          hardware: 'ESP32 DevKit',
          firmwareVersion: '0.3.0',
          moduleVersion: '0.1.0',
          testSuiteVersion: '1',
        },
      }),
    ).toBe('L5');
  });

  it('throws below L0 — an invalid manifest counts as nothing', () => {
    expect(() => evaluateConformanceLevel({ ...full, manifestValid: false })).toThrowError(
      /Nothing else counts/,
    );
  });

  it('names every level', () => {
    expect(CONFORMANCE_LEVELS).toEqual(['L0', 'L1', 'L2', 'L3', 'L4', 'L5']);
    expect(LEVEL_NAMES.L5).toBe('HARDWARE_VERIFIED');
    expect(LEVEL_NAMES.L0).toBe('MANIFEST_VALID');
  });

  it('serializes records with the dated hardware test when present', () => {
    const record = conformanceRecord({ id: 'test/x', version: '1.0.0' }, 'L5', {
      ...full,
      hardwareRecord: {
        date: '2026-09-02',
        hardware: 'Pico W',
        firmwareVersion: 'mp-1.21',
        moduleVersion: '1.0.0',
        testSuiteVersion: '1',
      },
    });
    expect(record).toMatchObject({ level: 'L5', levelName: 'HARDWARE_VERIFIED' });
    expect(record.hardwareTested).toBeDefined();
  });
});
