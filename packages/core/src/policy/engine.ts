import { PolicyConstraintViolation, PolicyPreconditionFailed } from './errors.js';
import type { PolicyContext, PolicyRule } from './types.js';

export function evaluatePolicies(rules: PolicyRule[], context: PolicyContext): void {
  for (const rule of rules) {
    if (rule.capability !== context.capability) {
      continue;
    }
    switch (rule.kind) {
      case 'numericRange':
        evaluateNumericRange(rule, context);
        break;
      case 'stateEquals':
        evaluateStateEquals(rule, context);
        break;
      case 'workspaceBounds':
        evaluateWorkspaceBounds(rule, context);
        break;
      case 'custom':
        rule.evaluate(context);
        break;
    }
  }
}

function evaluateNumericRange(
  rule: Extract<PolicyRule, { kind: 'numericRange' }>,
  context: PolicyContext,
): void {
  const value = context.payload[rule.field];
  if (typeof value !== 'number' || !Number.isFinite(value)) {
    throw new PolicyConstraintViolation(rule.message ?? `${rule.field} must be a finite number.`, {
      deviceId: context.deviceId,
      capability: context.capability,
      field: rule.field,
    });
  }
  if (value < rule.min || value > rule.max) {
    throw new PolicyConstraintViolation(
      rule.message ??
        `${rule.field} must be between ${rule.min} and ${rule.max}, received ${value}.`,
      {
        deviceId: context.deviceId,
        capability: context.capability,
        field: rule.field,
        min: rule.min,
        max: rule.max,
        received: value,
      },
    );
  }
}

function evaluateStateEquals(
  rule: Extract<PolicyRule, { kind: 'stateEquals' }>,
  context: PolicyContext,
): void {
  const actual = context.operationalState[rule.field];
  if (actual !== rule.equals) {
    throw new PolicyPreconditionFailed(
      rule.message ??
        `'${context.capability}' requires ${rule.field} == ${String(rule.equals)}, current ${String(actual)}.`,
      {
        deviceId: context.deviceId,
        capability: context.capability,
        field: rule.field,
        expected: rule.equals,
        actual,
      },
    );
  }
}

function evaluateWorkspaceBounds(
  rule: Extract<PolicyRule, { kind: 'workspaceBounds' }>,
  context: PolicyContext,
): void {
  for (const axis of ['x', 'y', 'z'] as const) {
    const value = context.payload[axis];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new PolicyConstraintViolation(`${axis} must be a finite number.`, {
        deviceId: context.deviceId,
        capability: context.capability,
        axis,
      });
    }
    const { min, max } = rule.fields[axis];
    if (value < min || value > max) {
      throw new PolicyConstraintViolation(
        rule.message ?? `${axis} must be between ${min} and ${max}, received ${value}.`,
        {
          deviceId: context.deviceId,
          capability: context.capability,
          axis,
          min,
          max,
          received: value,
        },
      );
    }
  }
}
