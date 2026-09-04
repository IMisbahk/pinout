import { resolve } from 'node:path';
import type { ExpectedFixture } from '../src/eval/evaluate.js';

export const repoRoot = resolve(import.meta.dirname, '../../..');

export const heatboxExpected: ExpectedFixture = {
  name: 'heatbox-sdk',
  device: { vendor: 'Acme', model: 'HeatBox 400', deviceClass: 'lab.environmental_chamber' },
  capabilities: [
    'temperature.read',
    'temperature.set',
    'door.open',
    'door.close',
    'experiment.start',
    'experiment.stop',
  ],
  documentedSafety: [{ capability: 'temperature.set', minimum: 10, maximum: 80 }],
  mustHaveUncertainties: false,
};

export const actuatorExpected: ExpectedFixture = {
  name: 'actuator-sdk',
  device: { model: 'RoboArm X1', deviceClass: 'robot.manipulator' },
  capabilities: [
    'motion.move_to',
    'motion.home',
    'motion.stop',
    'gripper.open',
    'gripper.close',
    'status.read',
  ],
};

export const ambiguousExpected: ExpectedFixture = {
  name: 'ambiguous-sdk',
  capabilities: ['temperature.read', 'temperature.set'],
  mustHaveUncertainties: true,
  forbiddenHardSafety: ['temperature.set'],
};
