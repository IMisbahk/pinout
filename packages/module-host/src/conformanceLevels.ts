/**
 * Module conformance levels (spec v1).
 *
 * Trust is a ladder, and each rung requires evidence:
 *
 *   L0 MANIFEST_VALID        — manifest parses and passes schema validation
 *   L1 BUILDS                — module compiles/loads
 *   L2 CONFORMANCE_PASS      — passes the generic module conformance kit
 *   L3 SIMULATION_VERIFIED   — behaves correctly against its simulator
 *   L4 INTEGRATION_VERIFIED  — behaves correctly through the daemon/module-host
 *   L5 HARDWARE_VERIFIED     — tested against real hardware (dated record)
 *
 * Do not call something "verified" merely because tests mocked it.
 */
import type { ModuleManifestLike } from './manifestTypes.js';

export type ConformanceLevel = 'L0' | 'L1' | 'L2' | 'L3' | 'L4' | 'L5';

export const CONFORMANCE_LEVELS: readonly ConformanceLevel[] = ['L0', 'L1', 'L2', 'L3', 'L4', 'L5'];

export const LEVEL_NAMES: Record<ConformanceLevel, string> = {
  L0: 'MANIFEST_VALID',
  L1: 'BUILDS',
  L2: 'CONFORMANCE_PASS',
  L3: 'SIMULATION_VERIFIED',
  L4: 'INTEGRATION_VERIFIED',
  L5: 'HARDWARE_VERIFIED',
};

export interface ConformanceEvidence {
  manifestValid: boolean;
  builds: boolean;
  conformancePassed: boolean;
  simulationVerified: boolean;
  integrationVerified: boolean;
  /** Hardware verification requires a dated record with versions. */
  hardwareRecord?: {
    date: string;
    hardware: string;
    firmwareVersion: string;
    moduleVersion: string;
    testSuiteVersion: string;
  };
}

export function evaluateConformanceLevel(evidence: ConformanceEvidence): ConformanceLevel {
  if (!evidence.manifestValid) {
    throw new Error('Conformance below L0: manifest is not valid. Nothing else counts.');
  }
  if (!evidence.builds) return 'L0';
  if (!evidence.conformancePassed) return 'L1';
  if (!evidence.simulationVerified) return 'L2';
  if (!evidence.integrationVerified) return 'L3';
  if (!evidence.hardwareRecord) return 'L4';
  return 'L5';
}

/** Serialize the achieved level for a catalog/manifest record. */
export function conformanceRecord(manifest: ModuleManifestLike, level: ConformanceLevel, evidence: ConformanceEvidence): Record<string, unknown> {
  const record: Record<string, unknown> = {
    moduleId: manifest.id ?? '(unknown)',
    moduleVersion: manifest.version ?? '(unknown)',
    level,
    levelName: LEVEL_NAMES[level],
  };
  if (evidence.hardwareRecord !== undefined) {
    record.hardwareTested = evidence.hardwareRecord;
  }
  return record;
}
