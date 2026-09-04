import { beforeEach, describe, expect, it } from 'vitest';
import { LeaseManager } from '../src/lease/leaseManager.js';
import {
  SafetyEngine,
  mergeModuleAndDeploymentRules,
  type SafetyRule,
} from '../src/policy/safety.js';

let now: number;
const clock = () => now;

beforeEach(() => {
  now = 1_000_000;
});

describe('SafetyEngine: rate', () => {
  it('previews without spending approvals or rate slots and rolls back rejected checks', () => {
    const engine = new SafetyEngine({
      rules: [
        { kind: 'rate', capability: 'x', maxPerWindow: 1 },
        { kind: 'approval', capability: 'x' },
        { kind: 'interlock', capability: 'x', interlock: 'door' },
      ],
    });
    const ctx = { deviceId: 'd', capability: 'x', payload: {}, operationalState: {} };
    engine.recordApproval({
      id: 'approval',
      deviceId: 'd',
      capability: 'x',
      grantedBy: 'operator',
    });
    expect(engine.check(ctx).allowed).toBe(false);
    engine.setInterlock('door', true);
    expect(engine.preview(ctx).allowed).toBe(true);
    expect(engine.preview(ctx).allowed).toBe(true);
    expect(engine.check(ctx).allowed).toBe(true);
    expect(engine.check(ctx).allowed).toBe(false);
  });
  it('allows up to the limit then rejects with SAFETY_RATE_LIMIT', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'rate', capability: 'gpio.write', maxPerWindow: 3, windowMs: 1000 }],
      now: clock,
    });
    const ctx = { deviceId: 'esp-01', capability: 'gpio.write', payload: {}, operationalState: {} };
    expect(engine.check(ctx).allowed).toBe(true);
    expect(engine.check(ctx).allowed).toBe(true);
    expect(engine.check(ctx).allowed).toBe(true);
    const rejected = engine.check(ctx);
    expect(rejected.allowed).toBe(false);
    expect(rejected.code).toBe('SAFETY_RATE_LIMIT');
  });

  it('the window slides: old invocations age out', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'rate', capability: 'gpio.write', maxPerWindow: 1, windowMs: 100 }],
      now: clock,
    });
    const ctx = { deviceId: 'esp-01', capability: 'gpio.write', payload: {}, operationalState: {} };
    expect(engine.check(ctx).allowed).toBe(true);
    expect(engine.check(ctx).allowed).toBe(false);
    now += 150;
    expect(engine.check(ctx).allowed).toBe(true);
  });

  it('enforce() throws PolicyConstraintViolation on rate limit', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'rate', capability: 'x', maxPerWindow: 1 }],
      now: clock,
    });
    const ctx = { deviceId: 'd', capability: 'x', payload: {}, operationalState: {} };
    engine.enforce(ctx);
    expect(() => engine.enforce(ctx)).toThrowError(/Rate limit/);
  });
});

describe('SafetyEngine: interlocks', () => {
  it('blocks until the interlock is satisfied', () => {
    const engine = new SafetyEngine({
      rules: [
        {
          kind: 'interlock',
          capability: 'experiment.start',
          interlock: 'door.closed',
          mustBe: true,
        },
      ],
      now: clock,
    });
    const ctx = {
      deviceId: 'chamber-01',
      capability: 'experiment.start',
      payload: {},
      operationalState: {},
    };
    expect(engine.check(ctx)).toMatchObject({
      allowed: false,
      code: 'SAFETY_INTERLOCK_NOT_SATISFIED',
    });
    engine.setInterlock('door.closed', true);
    expect(engine.check(ctx).allowed).toBe(true);
  });

  it('supports non-boolean interlock values', () => {
    const engine = new SafetyEngine({
      rules: [
        {
          kind: 'interlock',
          capability: 'pump.start',
          interlock: 'valve.position',
          mustBe: 'open',
        },
      ],
      now: clock,
    });
    const ctx = {
      deviceId: 'plant-01',
      capability: 'pump.start',
      payload: {},
      operationalState: {},
    };
    engine.setInterlock('valve.position', 'closed');
    expect(engine.check(ctx).allowed).toBe(false);
    engine.setInterlock('valve.position', 'open');
    expect(engine.check(ctx).allowed).toBe(true);
  });
});

describe('SafetyEngine: sequences', () => {
  it('requires the sequence to have reached a step', () => {
    const engine = new SafetyEngine({
      rules: [
        { kind: 'sequence', capability: 'experiment.start', sequence: 'startup', atLeastStep: 2 },
      ],
      now: clock,
    });
    const ctx = {
      deviceId: 'chamber-01',
      capability: 'experiment.start',
      payload: {},
      operationalState: {},
    };
    engine.setSequenceStep('startup', 1);
    expect(engine.check(ctx)).toMatchObject({
      allowed: false,
      code: 'SAFETY_SEQUENCE_NOT_SATISFIED',
    });
    engine.setSequenceStep('startup', 2);
    expect(engine.check(ctx).allowed).toBe(true);
  });
});

describe('SafetyEngine: approvals', () => {
  it('requires a fresh, unused approval and consumes it', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'approval', capability: 'gripper.close' }],
      now: clock,
    });
    const ctx = {
      deviceId: 'arm-01',
      capability: 'gripper.close',
      payload: {},
      operationalState: {},
    };
    expect(engine.check(ctx)).toMatchObject({ allowed: false, code: 'SAFETY_APPROVAL_REQUIRED' });

    engine.recordApproval({
      id: 'appr-1',
      deviceId: 'arm-01',
      capability: 'gripper.close',
      grantedBy: 'operator',
    });
    expect(engine.check(ctx).allowed).toBe(true);
    // Approval was consumed: second call is rejected.
    expect(engine.check(ctx)).toMatchObject({ allowed: false, code: 'SAFETY_APPROVAL_REQUIRED' });
  });

  it('rejects expired approvals', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'approval', capability: 'gripper.close' }],
      now: clock,
    });
    engine.recordApproval({
      id: 'appr-2',
      deviceId: 'arm-01',
      capability: 'gripper.close',
      grantedBy: 'operator',
      expiresAt: now + 100,
    });
    const ctx = {
      deviceId: 'arm-01',
      capability: 'gripper.close',
      payload: {},
      operationalState: {},
    };
    expect(engine.check(ctx).allowed).toBe(true);
    now += 200;
    expect(engine.check(ctx)).toMatchObject({ allowed: false, code: 'SAFETY_APPROVAL_REQUIRED' });
  });
});

describe('SafetyEngine: leases', () => {
  it('gates capability behind an active lease owned by the caller', () => {
    const leases = new LeaseManager({ now: clock });
    const engine = new SafetyEngine({
      rules: [{ kind: 'lease', capability: 'motion.move_to' }],
      leaseManager: leases,
      now: clock,
    });
    const ctx = (owner?: string) => ({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      payload: {},
      operationalState: {},
      ...(owner === undefined ? {} : { owner }),
    });

    expect(engine.check(ctx()).allowed).toBe(false);
    expect(engine.check(ctx('agent-a')).allowed).toBe(false);
    const lease = leases.acquire({
      scope: { kind: 'device', deviceId: 'arm-01' },
      owner: 'agent-a',
    });
    expect(engine.check(ctx('agent-a')).allowed).toBe(true);
    expect(engine.check(ctx('agent-b'))).toMatchObject({
      allowed: false,
      code: 'SAFETY_LEASE_REQUIRED',
    });

    now += 120_000;
    expect(engine.check(ctx('agent-a')).allowed).toBe(false);
    void lease;
  });
});

describe('SafetyEngine: deadman', () => {
  it('requires a fresh heartbeat', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'deadman', capability: 'base.move', maxAgeMs: 500 }],
      now: clock,
    });
    const ctx = {
      deviceId: 'rover-01',
      capability: 'base.move',
      payload: {},
      operationalState: {},
    };
    expect(engine.check(ctx)).toMatchObject({ allowed: false, code: 'SAFETY_DEADMAN_STALE' });
    engine.heartbeatDeadman('rover-01');
    expect(engine.check(ctx).allowed).toBe(true);
    now += 600;
    expect(engine.check(ctx)).toMatchObject({ allowed: false, code: 'SAFETY_DEADMAN_STALE' });
  });
});

describe('SafetyEngine: resource budgets', () => {
  it('charges cost per invocation and exhausts the budget', () => {
    const engine = new SafetyEngine({
      rules: [{ kind: 'resource', capability: 'base.move', resource: 'motion-seconds', cost: 2 }],
      now: clock,
    });
    engine.configureBudget('motion-seconds', 5, 1000);
    const ctx = {
      deviceId: 'rover-01',
      capability: 'base.move',
      payload: {},
      operationalState: {},
    };
    expect(engine.check(ctx).allowed).toBe(true);
    expect(engine.check(ctx).allowed).toBe(true);
    expect(engine.check(ctx)).toMatchObject({ allowed: false, code: 'SAFETY_BUDGET_EXHAUSTED' });
    now += 1500;
    expect(engine.check(ctx).allowed).toBe(true);
  });
});

describe('SafetyEngine: legacy rule compatibility', () => {
  it('still enforces numericRange and stateEquals', () => {
    const rules: SafetyRule[] = [
      {
        kind: 'numericRange',
        capability: 'temperature.set',
        field: 'target',
        min: 0,
        max: 80,
        provenance: 'DOCUMENTED',
      },
      { kind: 'stateEquals', capability: 'temperature.set', field: 'door', equals: 'closed' },
    ];
    const engine = new SafetyEngine({ rules, now: clock });
    const ctx = (target: number, door: string) => ({
      deviceId: 'chamber-01',
      capability: 'temperature.set',
      payload: { target },
      operationalState: { door },
    });
    expect(engine.check(ctx(50, 'closed')).allowed).toBe(true);
    expect(engine.check(ctx(90, 'closed'))).toMatchObject({
      allowed: false,
      code: 'POLICY_CONSTRAINT_VIOLATION',
    });
    expect(engine.check(ctx(50, 'open'))).toMatchObject({
      allowed: false,
      code: 'POLICY_PRECONDITION_FAILED',
    });
  });
});

describe('mergeModuleAndDeploymentRules', () => {
  it('accepts stricter deployment ranges', () => {
    const moduleRules: SafetyRule[] = [
      { kind: 'numericRange', capability: 'temperature.set', field: 'target', min: 0, max: 80 },
    ];
    const deployment: SafetyRule[] = [
      { kind: 'numericRange', capability: 'temperature.set', field: 'target', min: 10, max: 60 },
    ];
    const { rules, conflicts } = mergeModuleAndDeploymentRules(moduleRules, deployment);
    expect(conflicts).toHaveLength(0);
    expect(rules).toHaveLength(2);
  });

  it('flags range widening as a conflict instead of applying it', () => {
    const moduleRules: SafetyRule[] = [
      { kind: 'numericRange', capability: 'temperature.set', field: 'target', min: 0, max: 80 },
    ];
    const deployment: SafetyRule[] = [
      { kind: 'numericRange', capability: 'temperature.set', field: 'target', min: 0, max: 120 },
    ];
    const { rules, conflicts } = mergeModuleAndDeploymentRules(moduleRules, deployment);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0]!.kind).toBe('range-widening');
    // Only the module rule survived.
    expect(rules.filter((r) => r.kind === 'numericRange')).toHaveLength(1);
  });

  it('flags contradicting stateEquals preconditions', () => {
    const moduleRules: SafetyRule[] = [
      { kind: 'stateEquals', capability: 'pump.start', field: 'valve', equals: 'open' },
    ];
    const deployment: SafetyRule[] = [
      { kind: 'stateEquals', capability: 'pump.start', field: 'valve', equals: 'closed' },
    ];
    const { conflicts } = mergeModuleAndDeploymentRules(moduleRules, deployment);
    expect(conflicts[0]!.kind).toBe('state-mismatch');
  });

  it('marks merged deployment rules as CONFIGURED provenance', () => {
    const { rules } = mergeModuleAndDeploymentRules(
      [],
      [{ kind: 'rate', capability: 'gpio.write', maxPerWindow: 10 }],
    );
    expect(rules[0]!.provenance).toBe('CONFIGURED');
  });

  it('allows deployment rules on unconstrained capabilities', () => {
    const moduleRules: SafetyRule[] = [
      { kind: 'numericRange', capability: 'temperature.set', field: 'target', min: 0, max: 80 },
    ];
    const deployment: SafetyRule[] = [{ kind: 'rate', capability: 'gpio.write', maxPerWindow: 5 }];
    const { rules, conflicts } = mergeModuleAndDeploymentRules(moduleRules, deployment);
    expect(conflicts).toHaveLength(0);
    expect(rules).toHaveLength(2);
  });
});
