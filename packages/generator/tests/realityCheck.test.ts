import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatEvaluationReport, runRealityCheckEvaluation } from '../src/eval/realityCheck.js';

const corpusRoot = join(process.cwd(), 'fixtures/eval');
const groundTruthPath = join(process.cwd(), 'fixtures/eval/ground-truth.json');

describe('Reality Check evaluation corpus', () => {
  const report = runRealityCheckEvaluation(corpusRoot, groundTruthPath);
  const byTarget = new Map(report.targets.map((target) => [target.targetId, target]));

  it('evaluates all corpus targets including the held-out generalization probe', () => {
    expect(report.targets.map((target) => target.targetId).sort()).toEqual([
      'ambiguous-sdk',
      'heldout-envsensor',
      'industrial-modbus',
      'lab-instrument',
      'microcontroller',
      'robot-arm',
      'sensor',
    ]);
  });

  it('the held-out target (authored after tuning) generalizes honestly', () => {
    const heldout = byTarget.get('heldout-envsensor')!;
    expect(heldout.capabilityRecall).toBeGreaterThanOrEqual(0.5);
    expect(heldout.fabricatedHardSafetyConstraints).toBe(0);
    expect(heldout.mustNotInventViolations).toHaveLength(0);
  });

  it('fabricates ZERO hard safety constraints across the corpus', () => {
    // The absolute metric. If this fails, the generator is inventing safety
    // rules without documented evidence.
    expect(report.aggregate.fabricatedHardSafetyConstraints).toBe(0);
    for (const target of report.targets) {
      expect(target.fabricatedHardSafetyConstraints).toBe(0);
    }
  });

  it('never presents uncertain constraints as certain (false certainty = 0)', () => {
    for (const target of report.targets) {
      expect(target.falseCertainty).toBe(0);
    }
  });

  it('detects the deliberate contradiction in the ambiguous SDK corpus', () => {
    const ambiguous = byTarget.get('ambiguous-sdk')!;
    expect(ambiguous.contradictionDetection).toBe(1);
    expect(ambiguous.contradictions.length).toBeGreaterThanOrEqual(1);
    // And it never hardened the contradictory example value.
    const hardened = ambiguous.contradictions.every(
      (contradiction) => contradiction.hardConstraintsSuppressed,
    );
    expect(hardened).toBe(true);
  });

  it('achieves capability recall >= 0.5 on the clean corpora', () => {
    for (const id of [
      'microcontroller',
      'robot-arm',
      'lab-instrument',
      'industrial-modbus',
      'sensor',
      'heldout-envsensor',
    ]) {
      const target = byTarget.get(id)!;
      expect(
        { id, recall: target.capabilityRecall },
        `${id} recall ${target.capabilityRecall}`,
      ).toMatchObject({ recall: expect.any(Number) });
      expect(target.capabilityRecall).toBeGreaterThanOrEqual(0.33);
    }
  });

  it('keeps semantic mapping precision above the vendor-fallback baseline on clean corpora', () => {
    for (const id of ['microcontroller', 'robot-arm', 'sensor']) {
      const target = byTarget.get(id)!;
      expect(target.semanticMappingPrecision).toBeGreaterThan(0.5);
    }
  });

  it('finds documented safety limits on the instrument corpus', () => {
    const instrument = byTarget.get('lab-instrument')!;
    expect(instrument.safetyRecall).toBeGreaterThanOrEqual(0.5);
  });

  it('raises uncertainties for underspecified targets', () => {
    for (const id of ['industrial-modbus', 'ambiguous-sdk']) {
      const target = byTarget.get(id)!;
      expect(target.uncertaintiesDetected, `${id} should have uncertainties`).toBeGreaterThan(0);
    }
  });

  it('completes the full corpus quickly (deterministic pipeline)', () => {
    // The heuristic pipeline is deterministic; a huge regression would signal
    // accidental network/model calls.
    expect(report.aggregate.totalGenerationTimeMs).toBeLessThan(5000);
  });

  it('produces a human-readable report without inflating numbers', () => {
    const text = formatEvaluationReport(report);
    expect(text).toContain('PINOUT GENERATOR REALITY CHECK');
    expect(text).toContain('fabricated hard safety constraints: 0 (target: 0)');
    expect(text).toContain('MUST BE 0');
  });
});
