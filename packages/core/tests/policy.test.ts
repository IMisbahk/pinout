import { describe, expect, it } from 'vitest';
import {
  PolicyConstraintViolation,
  PolicyPreconditionFailed,
  evaluatePolicies,
} from '@pinout/core';
import {
  chamberExperimentStartPolicy,
  chamberTemperaturePolicy,
} from '../src/modules/chamber/capabilities.js';
import { robotArmWorkspacePolicy } from '../src/modules/robotArm/capabilities.js';

describe('policy engine', () => {
  it('enforces numeric temperature bounds', () => {
    expect(() =>
      evaluatePolicies([chamberTemperaturePolicy], {
        deviceId: 'chamber-sim-01',
        capability: 'temperature.set',
        payload: { value: 200 },
        operationalState: { door: 'closed' },
      }),
    ).toThrow(PolicyConstraintViolation);
  });

  it('allows safe temperature', () => {
    expect(() =>
      evaluatePolicies([chamberTemperaturePolicy], {
        deviceId: 'chamber-sim-01',
        capability: 'temperature.set',
        payload: { value: 40 },
        operationalState: {},
      }),
    ).not.toThrow();
  });

  it('requires door closed before experiment.start', () => {
    expect(() =>
      evaluatePolicies([chamberExperimentStartPolicy], {
        deviceId: 'chamber-sim-01',
        capability: 'experiment.start',
        payload: {},
        operationalState: { door: 'open' },
      }),
    ).toThrow(PolicyPreconditionFailed);
  });

  it('rejects workspace violations for motion.move_to', () => {
    expect(() =>
      evaluatePolicies([robotArmWorkspacePolicy], {
        deviceId: 'arm-sim-01',
        capability: 'motion.move_to',
        payload: { x: 2, y: 0, z: 0.5 },
        operationalState: {},
      }),
    ).toThrow(PolicyConstraintViolation);
  });
});
