import type { PolicyRule } from '../policy/types.js';

export interface DeclarativeNumericConstraint {
  min?: number;
  max?: number;
}

export interface DeclarativeCapabilityPolicy {
  constraints?: Record<string, DeclarativeNumericConstraint>;
  requires?: Record<string, string | number | boolean>;
}

export type DeclarativePolicyMap = Record<string, DeclarativeCapabilityPolicy>;

/** Convert declarative module policy definitions into runtime policy rules. */
export function policiesFromDeclarative(map: DeclarativePolicyMap): PolicyRule[] {
  const rules: PolicyRule[] = [];
  for (const [capability, policy] of Object.entries(map)) {
    if (policy.constraints) {
      for (const [field, bounds] of Object.entries(policy.constraints)) {
        if (bounds.min !== undefined && bounds.max !== undefined) {
          rules.push({
            kind: 'numericRange',
            capability,
            field,
            min: bounds.min,
            max: bounds.max,
          });
        } else if (bounds.max !== undefined) {
          rules.push({
            kind: 'numericRange',
            capability,
            field,
            min: Number.NEGATIVE_INFINITY,
            max: bounds.max,
          });
        } else if (bounds.min !== undefined) {
          rules.push({
            kind: 'numericRange',
            capability,
            field,
            min: bounds.min,
            max: Number.POSITIVE_INFINITY,
          });
        }
      }
    }
    if (policy.requires) {
      for (const [field, equals] of Object.entries(policy.requires)) {
        rules.push({
          kind: 'stateEquals',
          capability,
          field,
          equals,
        });
      }
    }
  }
  return rules;
}

/**
 * Merge module default policies with deployment overrides.
 * Deployment may only tighten limits — it cannot widen beyond module defaults.
 */
export function mergeModulePolicies(
  modulePolicies: PolicyRule[],
  deploymentPolicies: PolicyRule[],
): PolicyRule[] {
  const merged = [...modulePolicies];
  for (const deployRule of deploymentPolicies) {
    const existingIndex = merged.findIndex(
      (rule) =>
        rule.capability === deployRule.capability &&
        rule.kind === deployRule.kind &&
        ruleKindField(rule) === ruleKindField(deployRule),
    );
    if (existingIndex < 0) {
      merged.push(deployRule);
      continue;
    }
    const existing = merged[existingIndex]!;
    if (
      existing.kind === 'numericRange' &&
      deployRule.kind === 'numericRange' &&
      existing.field === deployRule.field
    ) {
      const mergedRule: Extract<PolicyRule, { kind: 'numericRange' }> = {
        kind: 'numericRange',
        capability: existing.capability,
        field: existing.field,
        min: Math.max(existing.min, deployRule.min),
        max: Math.min(existing.max, deployRule.max),
      };
      if (deployRule.message !== undefined) {
        mergedRule.message = deployRule.message;
      } else if (existing.message !== undefined) {
        mergedRule.message = existing.message;
      }
      merged[existingIndex] = mergedRule;
      continue;
    }
    if (
      existing.kind === 'stateEquals' &&
      deployRule.kind === 'stateEquals' &&
      existing.field === deployRule.field
    ) {
      merged[existingIndex] = deployRule;
      continue;
    }
    merged.push(deployRule);
  }
  return merged;
}

function ruleKindField(rule: PolicyRule): string | undefined {
  if (rule.kind === 'numericRange' || rule.kind === 'stateEquals') {
    return rule.field;
  }
  if (rule.kind === 'workspaceBounds') {
    return 'workspace';
  }
  return undefined;
}
