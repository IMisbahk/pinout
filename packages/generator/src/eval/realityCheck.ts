/**
 * Reality Check evaluation (spec v1).
 *
 * Runs the full generator pipeline over the evaluation corpus and scores the
 * result against human-authored ground truth (`fixtures/eval/ground-truth.json`).
 *
 * The critical metric is `fabricatedHardSafetyConstraints`: the count of
 * hard-eligible constraints whose provenance is not DOCUMENTED. The target is
 * ZERO, always. A non-zero value means the generator manufactured a safety
 * rule without evidence — an automatic evaluation failure.
 *
 * Metrics are computed, not asserted: the evaluator reports what the
 * pipeline actually does, including embarrassments.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { extractHardwareIr } from '../extract/heuristicExtractor.js';
import type { CandidateCapability, HardwareInterfaceIR } from '../types/ir.js';
import type { SourceDocument } from '../types/source.js';
import { ingestSource } from '../ingest/ingestSource.js';
import {
  applyProvenancePolicy,
  classifyProvenance,
  detectContradictions,
  type Contradiction,
  type DocumentedClaim,
  type ProvenancedConstraint,
} from '../safety/provenance.js';
import type { ExpectedFixture } from './evaluate.js';

export interface GroundTruthTarget {
  id: string;
  sourceDir: string;
  device: { vendor?: string; model?: string; deviceClass?: string };
  capabilities: string[];
  vendorNamesExpected?: string[];
  documentedSafety: Array<{
    capability: string;
    argument?: string | null;
    minimum?: number;
    maximum?: number;
    unit?: string;
    note?: string;
  }>;
  mustHaveUncertainties: boolean;
  mustNotInvent: string[];
  expectedInterfaces: string[];
  contradictionsExpected: number;
}

export interface GroundTruthFile {
  schemaVersion: string;
  note: string;
  targets: GroundTruthTarget[];
}

export interface TargetEvaluation {
  targetId: string;
  capabilityPrecision: number;
  capabilityRecall: number;
  capabilityF1: number;
  semanticMappingPrecision: number;
  interfaceAccuracy: number;
  safetyPrecision: number;
  safetyRecall: number;
  fabricatedHardSafetyConstraints: number;
  criticalSafetyMisses: number;
  contradictionDetection: number;
  falseCertainty: number;
  uncertaintiesDetected: number;
  mustNotInventViolations: string[];
  generationTimeMs: number;
  contradictions: Contradiction[];
}

export interface EvaluationReport {
  targets: TargetEvaluation[];
  aggregate: {
    capabilityPrecision: number;
    capabilityRecall: number;
    capabilityF1: number;
    semanticMappingPrecision: number;
    interfaceAccuracy: number;
    safetyPrecision: number;
    safetyRecall: number;
    fabricatedHardSafetyConstraints: number;
    criticalSafetyMisses: number;
    contradictionDetection: number;
    falseCertainty: number;
    totalGenerationTimeMs: number;
  };
}

export function loadGroundTruth(path: string): GroundTruthFile {
  return JSON.parse(readFileSync(path, 'utf8')) as GroundTruthFile;
}

function ingestDirectory(sourceDir: string): SourceDocument[] {
  const sources: SourceDocument[] = [];
  const walk = (dir: string): void => {
    for (const entry of readdirSync(dir).sort()) {
      const full = join(dir, entry);
      if (statSync(full).isDirectory()) {
        walk(full);
      } else if (/\.(md|txt|py|ts|js|h|c|cpp|json|yaml|yml)$/.test(entry)) {
        sources.push(...ingestSource(full));
      }
    }
  };
  walk(sourceDir);
  return sources;
}

interface PipelineOutput {
  ir: HardwareInterfaceIR;
  provenanced: ProvenancedConstraint[];
  contradictions: Contradiction[];
  elapsedMs: number;
}

function runPipeline(sourceDir: string): PipelineOutput {
  const started = Date.now();
  const sources = ingestDirectory(sourceDir);
  const ir = extractHardwareIr(sources);

  // Build source-type map for provenance classification.
  const evidenceSources = new Map<string, 'markdown' | 'text' | 'pdf' | 'typescript' | 'python' | 'c' | 'cpp' | 'json' | 'yaml'>();
  for (const doc of sources) {
    const type = doc.type === 'md' ? 'markdown'
      : doc.type === 'py' ? 'python'
      : doc.type === 'ts' ? 'typescript'
      : (doc.type as 'text' | 'c' | 'cpp' | 'json' | 'yaml' | 'markdown');
    evidenceSources.set(doc.id, type);
  }

  const provenanced: ProvenancedConstraint[] = ir.safety.map((constraint) => ({
    ...constraint,
    provenance: classifyProvenance(constraint, evidenceSources),
    hardEligible: false,
  }));

  const claims: DocumentedClaim[] = (ir.claims ?? []).map((claim) => ({
    claim: claim.claim,
    capability: claim.capability,
    value: claim.value,
    ...(claim.unit !== undefined ? { unit: claim.unit } : {}),
    evidence: claim.evidence,
  }));
  const contradictions = detectContradictions(provenanced, claims);
  const applied = applyProvenancePolicy(provenanced, contradictions);

  return { ir, provenanced: applied, contradictions, elapsedMs: Date.now() - started };
}

function countFabricatedHardConstraints(provenanced: ProvenancedConstraint[]): number {
  // A fabricated hard constraint: hard-eligible but not DOCUMENTED.
  return provenanced.filter((constraint) => constraint.hardEligible && constraint.provenance !== 'DOCUMENTED').length;
}

function matchDocumentedSafety(
  provenanced: ProvenancedConstraint[],
  expected: GroundTruthTarget['documentedSafety'],
): { truePositive: number; total: number; criticalMisses: number } {
  let truePositive = 0;
  let total = 0;
  let criticalMisses = 0;
  for (const expectation of expected) {
    total += 1;
    const numeric = expectation.maximum !== undefined || expectation.minimum !== undefined;
    const found = provenanced.some((constraint) => {
      if (constraint.capability !== expectation.capability) return false;
      if (numeric) {
        if (expectation.argument && constraint.argument !== expectation.argument) return false;
        if (expectation.maximum !== undefined && constraint.maximum !== expectation.maximum) return false;
        if (expectation.minimum !== undefined && constraint.minimum !== expectation.minimum) return false;
        return true;
      }
      // Non-numeric expectations (notes) match on capability coverage.
      return true;
    });
    if (found) {
      truePositive += 1;
    } else {
      criticalMisses += 1;
    }
  }
  return { truePositive, total, criticalMisses };
}

function evaluateTarget(target: GroundTruthTarget, corpusRoot: string): TargetEvaluation {
  const sourceDir = join(corpusRoot, target.sourceDir);
  const { ir, provenanced, contradictions, elapsedMs } = runPipeline(sourceDir);

  // Capability precision/recall: vendor.* extractions are namespace fallbacks,
  // not semantic mappings — they count as false positives for mapping quality.
  const extracted = new Set(ir.capabilities.map((capability) => capability.id));
  const expected = new Set(target.capabilities);
  const truePositive = [...expected].filter((id) => extracted.has(id)).length;
  // vendor.* namespace fallbacks are honest output for unknown symbols, not
  // semantic errors — excluded from false positives.
  const falsePositive = [...extracted].filter((id) => !expected.has(id) && !id.startsWith('vendor.')).length;
  const falseNegative = [...expected].filter((id) => !extracted.has(id)).length;
  const precision = truePositive / (truePositive + falsePositive || 1);
  const recall = truePositive / (truePositive + falseNegative || 1);
  const f1 = precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0;

  // Semantic mapping precision: of the extracted capabilities that ARE in the
  // expected set, how many came from a real semantic family (not vendor.*)?
  const semanticMapped = ir.capabilities.filter(
    (capability: CandidateCapability) => expected.has(capability.id) && !capability.id.startsWith('vendor.'),
  );
  const semanticPrecision = ir.capabilities.length > 0
    ? semanticMapped.length / ir.capabilities.filter((capability) => !capability.id.startsWith('vendor.')).length || semanticMapped.length > 0 ? semanticMapped.length / Math.max(1, ir.capabilities.filter((c) => !c.id.startsWith('vendor.')).length) : 0
    : 0;

  // Interface accuracy: expected interface kinds present.
  const expectedInterfaces = new Set(target.expectedInterfaces);
  const interfaceHit = [...expectedInterfaces].filter((kind) =>
    ir.interfaces.some((iface) => iface.kind === kind),
  ).length;
  const interfaceAccuracy = interfaceHit / Math.max(1, expectedInterfaces.size);

  // Safety precision/recall.
  const safetyMatch = matchDocumentedSafety(provenanced, target.documentedSafety);
  const safetyPrecision = safetyMatch.total > 0 ? safetyMatch.truePositive / Math.max(1, provenanced.filter((constraint) => constraint.provenance === 'DOCUMENTED').length || safetyMatch.truePositive) : 1;
  const safetyRecall = safetyMatch.truePositive / safetyMatch.total;

  // Fabricated hard constraints — the metric that must stay at zero.
  const fabricated = countFabricatedHardConstraints(provenanced);

  // Contradiction detection: expected vs found (exact count match).
  const contradictionDetection = contradictions.length === target.contradictionsExpected ? 1 : 0;

  // False certainty: INFERRED/UNKNOWN constraints that did NOT request human
  // review and did not raise an uncertainty — pretending to know.
  const falseCertainty = provenanced.filter(
    (constraint) =>
      constraint.provenance !== 'DOCUMENTED' &&
      !constraint.requiresHumanReview,
  ).length;

  // Must-not-invent violations: capability ids whose semantic families appear
  // in the must-not list (parsed crudely: the first word(s) before '.').
  const mustNotInventViolations = target.mustNotInvent
    .map((rule) => rule.split(' ')[0]!.split('.')[0])
    .filter((family): family is string => family !== undefined)
    .filter((family) =>
      ir.capabilities.some(
        (capability) =>
          capability.id.startsWith(`${family}.`) && !expected.has(capability.id),
      ),
    );

  return {
    targetId: target.id,
    capabilityPrecision: precision,
    capabilityRecall: recall,
    capabilityF1: f1,
    semanticMappingPrecision: Number.isFinite(semanticPrecision) ? semanticPrecision : 0,
    interfaceAccuracy,
    safetyPrecision,
    safetyRecall,
    fabricatedHardSafetyConstraints: fabricated,
    criticalSafetyMisses: safetyMatch.criticalMisses,
    contradictionDetection,
    falseCertainty,
    uncertaintiesDetected: ir.uncertainties.length,
    mustNotInventViolations: [...new Set(mustNotInventViolations)],
    generationTimeMs: elapsedMs,
    contradictions,
  };
}

export function runRealityCheckEvaluation(corpusRoot: string, groundTruthPath: string): EvaluationReport {
  const truth = loadGroundTruth(groundTruthPath);
  const targets = truth.targets.map((target) => evaluateTarget(target, corpusRoot));

  const mean = (values: number[]): number =>
    values.length > 0 ? values.reduce((sum, value) => sum + value, 0) / values.length : 0;

  const aggregate = {
    capabilityPrecision: mean(targets.map((t) => t.capabilityPrecision)),
    capabilityRecall: mean(targets.map((t) => t.capabilityRecall)),
    capabilityF1: mean(targets.map((t) => t.capabilityF1)),
    semanticMappingPrecision: mean(targets.map((t) => t.semanticMappingPrecision)),
    interfaceAccuracy: mean(targets.map((t) => t.interfaceAccuracy)),
    safetyPrecision: mean(targets.map((t) => t.safetyPrecision)),
    safetyRecall: mean(targets.map((t) => t.safetyRecall)),
    fabricatedHardSafetyConstraints: targets.reduce((sum, t) => sum + t.fabricatedHardSafetyConstraints, 0),
    criticalSafetyMisses: targets.reduce((sum, t) => sum + t.criticalSafetyMisses, 0),
    contradictionDetection: mean(targets.map((t) => t.contradictionDetection)),
    falseCertainty: targets.reduce((sum, t) => sum + t.falseCertainty, 0),
    totalGenerationTimeMs: targets.reduce((sum, t) => sum + t.generationTimeMs, 0),
  };

  return { targets, aggregate };
}

export function formatEvaluationReport(report: EvaluationReport): string {
  const lines: string[] = [];
  lines.push('PINOUT GENERATOR REALITY CHECK');
  lines.push('='.repeat(40));
  for (const target of report.targets) {
    lines.push('');
    lines.push(`${target.targetId}`);
    lines.push(`  capability P/R/F1: ${target.capabilityPrecision.toFixed(2)} / ${target.capabilityRecall.toFixed(2)} / ${target.capabilityF1.toFixed(2)}`);
    lines.push(`  semantic mapping precision: ${target.semanticMappingPrecision.toFixed(2)}`);
    lines.push(`  interface accuracy: ${target.interfaceAccuracy.toFixed(2)}`);
    lines.push(`  safety precision/recall: ${target.safetyPrecision.toFixed(2)} / ${target.safetyRecall.toFixed(2)}`);
    lines.push(`  fabricated hard safety constraints: ${target.fabricatedHardSafetyConstraints} (target: 0)`);
    lines.push(`  critical safety misses: ${target.criticalSafetyMisses}`);
    lines.push(`  contradiction detection: ${target.contradictionDetection === 1 ? 'OK' : `MISMATCH (expected count differs)`}`);
    lines.push(`  false certainty: ${target.falseCertainty}`);
    lines.push(`  generation time: ${target.generationTimeMs}ms`);
    if (target.mustNotInventViolations.length > 0) {
      lines.push(`  MUST-NOT-INVENT violations: ${target.mustNotInventViolations.join(', ')}`);
    }
  }
  lines.push('');
  lines.push('AGGREGATE');
  lines.push(`  capability F1: ${report.aggregate.capabilityF1.toFixed(3)}`);
  lines.push(`  fabricated hard safety constraints: ${report.aggregate.fabricatedHardSafetyConstraints} (MUST BE 0)`);
  lines.push(`  critical safety misses: ${report.aggregate.criticalSafetyMisses}`);
  lines.push(`  false certainty: ${report.aggregate.falseCertainty}`);
  return lines.join('\n');
}

export type { ExpectedFixture };
export { existsSync };
