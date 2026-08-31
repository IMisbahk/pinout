import type { HardwareInterfaceIR } from '../types/ir.js';

export interface ExpectedFixture {
  name: string;
  device?: {
    vendor?: string;
    model?: string;
    deviceClass?: string;
  };
  capabilities: string[];
  documentedSafety?: Array<{
    capability: string;
    minimum?: number;
    maximum?: number;
  }>;
  mustHaveUncertainties?: boolean;
  forbiddenHardSafety?: string[];
}

export interface EvaluationMetrics {
  deviceIdentification: number;
  capabilityPrecision: number;
  capabilityRecall: number;
  constraintAccuracy: number;
  falseSafetyConstraints: number;
  uncertaintyDetected: boolean;
}

export function evaluateIrAgainstExpected(
  ir: HardwareInterfaceIR,
  expected: ExpectedFixture,
): EvaluationMetrics {
  const extractedCaps = new Set(ir.capabilities.map((c) => c.id));
  const expectedCaps = new Set(expected.capabilities);

  let truePositive = 0;
  for (const cap of expectedCaps) {
    if (extractedCaps.has(cap)) {
      truePositive += 1;
    }
  }
  const falsePositive = [...extractedCaps].filter(
    (c) => !expectedCaps.has(c) && !c.startsWith('vendor.'),
  ).length;
  const falseNegative = [...expectedCaps].filter((c) => !extractedCaps.has(c)).length;

  const precision = truePositive / (truePositive + falsePositive || 1);
  const recall = truePositive / (truePositive + falseNegative || 1);

  let deviceScore = 0;
  let deviceChecks = 0;
  if (expected.device?.vendor) {
    deviceChecks += 1;
    if (ir.device.vendor?.toLowerCase().includes(expected.device.vendor.toLowerCase())) {
      deviceScore += 1;
    }
  }
  if (expected.device?.model) {
    deviceChecks += 1;
    if (ir.device.model?.includes(expected.device.model)) {
      deviceScore += 1;
    }
  }
  if (expected.device?.deviceClass) {
    deviceChecks += 1;
    if (ir.device.deviceClass === expected.device.deviceClass) {
      deviceScore += 1;
    }
  }

  let constraintMatches = 0;
  for (const expectedConstraint of expected.documentedSafety ?? []) {
    const match = ir.safety.find(
      (s) =>
        s.capability === expectedConstraint.capability &&
        s.documented &&
        !s.requiresHumanReview &&
        s.minimum === expectedConstraint.minimum &&
        s.maximum === expectedConstraint.maximum,
    );
    if (match) {
      constraintMatches += 1;
    }
  }
  const constraintAccuracy =
    (expected.documentedSafety?.length ?? 0) === 0
      ? 1
      : constraintMatches / (expected.documentedSafety?.length ?? 1);

  let falseSafety = 0;
  for (const forbidden of expected.forbiddenHardSafety ?? []) {
    const bad = ir.safety.find(
      (s) => s.capability === forbidden && s.documented && !s.requiresHumanReview,
    );
    if (bad) {
      falseSafety += 1;
    }
  }

  const uncertaintyDetected = !expected.mustHaveUncertainties || ir.uncertainties.length > 0;

  return {
    deviceIdentification: deviceChecks === 0 ? 1 : deviceScore / deviceChecks,
    capabilityPrecision: precision,
    capabilityRecall: recall,
    constraintAccuracy,
    falseSafetyConstraints: falseSafety,
    uncertaintyDetected,
  };
}
