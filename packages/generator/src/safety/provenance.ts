/**
 * Safety provenance and contradiction detection for the generator (Reality Check).
 *
 * Every safety assertion the generator produces carries provenance:
 *   DOCUMENTED  — stated by vendor documentation with evidence
 *   INFERRED    — guessed by tooling; never a hard rule automatically
 *   UNKNOWN     — nothing known
 *   CONFLICTED  — two sources disagree; requires human review
 *
 * The core safety law: contradictions are surfaced, never silently resolved,
 * and NO hard policy is auto-generated from INFERRED or CONFLICTED claims.
 */
import type { CandidateSafetyConstraint, EvidenceReference } from '../types/ir.js';

export type SafetyProvenance = 'DOCUMENTED' | 'INFERRED' | 'UNKNOWN' | 'CONFLICTED';

export interface ProvenancedConstraint extends CandidateSafetyConstraint {
  provenance: SafetyProvenance;
  /** True only when this may become a hard policy rule. */
  hardEligible: boolean;
  conflictWith?: string[];
  /** Stated unit for the bound when the source declared one. */
  unit?: string;
}

export interface Contradiction {
  id: string;
  kind: 'numeric-conflict' | 'unit-conflict' | 'supported-conflict' | 'precondition-conflict' | 'config-conflict';
  message: string;
  a: CandidateSafetyConstraint | DocumentedClaim;
  b: CandidateSafetyConstraint | DocumentedClaim;
  resolution: 'REQUIRES_HUMAN_REVIEW';
  /** Neither side is applied as a hard rule. */
  hardConstraintsSuppressed: boolean;
}

export interface DocumentedClaim {
  claim: string;
  capability?: string;
  value?: number;
  unit?: string;
  supported?: boolean;
  evidence: EvidenceReference[];
}

const UNIT_FAMILIES: Record<string, string[]> = {
  temperature: ['C', 'F', 'K'],
  voltage: ['V', 'mV'],
  current: ['A', 'mA'],
  length: ['m', 'mm', 'cm'],
  speed: ['m/s', 'mm/s', 'rpm', 'deg/s', 'rad/s'],
  pressure: ['Pa', 'kPa', 'bar', 'psi'],
};

function unitFamily(unit: string | undefined): string | undefined {
  if (!unit) return undefined;
  for (const [family, units] of Object.entries(UNIT_FAMILIES)) {
    if (units.includes(unit)) return family;
  }
  return undefined;
}

/**
 * Classify provenance for a constraint: DOCUMENTED requires evidence from a
 * documentation-type source AND a high confidence band; anything guessed is
 * INFERRED; missing evidence is UNKNOWN.
 */
export function classifyProvenance(
  constraint: CandidateSafetyConstraint,
  evidenceSources: Map<string, 'markdown' | 'text' | 'pdf' | 'typescript' | 'python' | 'c' | 'cpp' | 'json' | 'yaml'>,
): SafetyProvenance {
  if (constraint.evidence.length === 0) return 'UNKNOWN';
  const documentedEvidence = constraint.evidence.some((ref) => {
    const ext = evidenceSources.get(ref.sourceId);
    return ext === 'markdown' || ext === 'text' || ext === 'pdf';
  });
  if (constraint.documented && documentedEvidence && constraint.confidence >= 0.8) {
    return 'DOCUMENTED';
  }
  if (constraint.confidence >= 0.8 && documentedEvidence) {
    return 'DOCUMENTED';
  }
  return 'INFERRED';
}

/**
 * Detect contradictions between claims/constraints. Numeric conflicts compare
 * bounds in the SAME unit family only — a 80 C limit never conflicts with a
 * 24 V limit. Cross-unit comparisons on the same capability ARE conflicts
 * (unit-conflict): they mean two sources disagreed about units.
 */
interface ComparableBound {
  capability: string;
  argument?: string;
  minimum?: number;
  maximum?: number;
  unit?: string;
  ref: ProvenancedConstraint | DocumentedClaim;
}

function normalizeToBounds(
  constraints: ProvenancedConstraint[],
  claims: DocumentedClaim[],
): ComparableBound[] {
  const bounds: ComparableBound[] = [];
  for (const constraint of constraints) {
    if (constraint.minimum !== undefined || constraint.maximum !== undefined) {
      bounds.push({
        capability: constraint.capability,
        ...(constraint.argument !== undefined ? { argument: constraint.argument } : {}),
        ...(constraint.minimum !== undefined ? { minimum: constraint.minimum } : {}),
        ...(constraint.maximum !== undefined ? { maximum: constraint.maximum } : {}),
        ref: constraint,
      });
      if (constraint.unit !== undefined) {
        bounds[bounds.length - 1]!.unit = constraint.unit;
      }
    }
  }
  for (const claim of claims) {
    if (claim.value !== undefined && claim.capability !== undefined) {
      const maximum = claim.claim.toLowerCase().includes('minimum') ? undefined : claim.value;
      bounds.push({
        capability: claim.capability,
        ...(maximum !== undefined ? { maximum } : { minimum: claim.value }),
        ...(claim.unit !== undefined ? { unit: claim.unit } : {}),
        ref: claim,
      });
    }
  }
  return bounds;
}

export function detectContradictions(
  constraints: ProvenancedConstraint[],
  claims: DocumentedClaim[] = [],
): Contradiction[] {
  const contradictions: Contradiction[] = [];
  const bounds = normalizeToBounds(constraints, claims);

  for (let i = 0; i < bounds.length; i += 1) {
    for (let j = i + 1; j < bounds.length; j += 1) {
      const a = bounds[i]!;
      const b = bounds[j]!;
      if (a.capability === b.capability) {
        const conflict = numericConflict(a, b);
        if (conflict) {
          contradictions.push({
            id: `contradiction-${contradictions.length + 1}`,
            kind: conflict.kind,
            message: conflict.message,
            a: a.ref,
            b: b.ref,
            resolution: 'REQUIRES_HUMAN_REVIEW',
            hardConstraintsSuppressed: true,
          });
        }
      }
    }
  }

  // Supported/unsupported conflicts: one source says a capability exists,
  // another says it does not.
  const supportedClaims = claims.filter((claim) => claim.supported !== undefined);
  for (let i = 0; i < supportedClaims.length; i += 1) {
    for (let j = i + 1; j < supportedClaims.length; j += 1) {
      const a = supportedClaims[i]!;
      const b = supportedClaims[j]!;
      if (a.claim === b.claim && a.supported !== b.supported) {
        contradictions.push({
          id: `contradiction-${contradictions.length + 1}`,
          kind: 'supported-conflict',
          message: `Sources disagree whether '${a.claim}' is supported (${a.supported} vs ${b.supported}).`,
          a,
          b,
          resolution: 'REQUIRES_HUMAN_REVIEW',
          hardConstraintsSuppressed: true,
        });
      }
    }
  }

  return contradictions;
}

function numericConflict(
  a: ComparableBound,
  b: ComparableBound,
): { kind: 'numeric-conflict' | 'unit-conflict'; message: string } | undefined {
  const familyA = unitFamily(a.unit);
  const familyB = unitFamily(b.unit);
  const unitMismatch =
    a.unit !== undefined && b.unit !== undefined && a.unit !== b.unit && familyA !== familyB;

  if (unitMismatch && a.argument === b.argument) {
    return {
      kind: 'unit-conflict',
      message: `Bounds for '${a.capability}.${a.argument}' are stated in incompatible units (${a.unit} vs ${b.unit}); semantic comparison impossible.`,
    };
  }
  if (a.unit !== b.unit && familyA !== familyB) return undefined;

  const argMatch = a.argument === b.argument;
  // An undefined argument means the bound applies to the capability as a
  // whole, so it is comparable against an argument-specific bound.
  if (!argMatch && a.argument !== undefined && b.argument !== undefined) return undefined;

  if (a.maximum !== undefined && b.maximum !== undefined && a.maximum !== b.maximum) {
    return {
      kind: 'numeric-conflict',
      message: `Maximum for '${a.capability}${a.argument ? `.${a.argument}` : ''}' is stated as ${a.maximum}${a.unit ?? ''} in one source and ${b.maximum}${b.unit ?? ''} in another.`,
    };
  }
  if (a.minimum !== undefined && b.minimum !== undefined && a.minimum !== b.minimum) {
    return {
      kind: 'numeric-conflict',
      message: `Minimum for '${a.capability}${a.argument ? `.${a.argument}` : ''}' is stated as ${a.minimum}${a.unit ?? ''} in one source and ${b.minimum}${b.unit ?? ''} in another.`,
    };
  }
  return undefined;
}

/**
 * Apply the provenance policy to produce final constraints:
 * - DOCUMENTED → hardEligible
 * - INFERRED / UNKNOWN / CONFLICTED → hardEligible=false ALWAYS
 * - Any constraint involved in a contradiction → CONFLICTED, hardEligible=false
 */
function constraintIdentity(constraint: ProvenancedConstraint): string {
  return `${constraint.capability}|${constraint.argument ?? ''}|${constraint.minimum ?? ''}|${constraint.maximum ?? ''}`;
}

export function applyProvenancePolicy(
  constraints: ProvenancedConstraint[],
  contradictions: Contradiction[],
): ProvenancedConstraint[] {
  const conflicted = new Set<string>();
  for (const contradiction of contradictions) {
    for (const side of [contradiction.a, contradiction.b]) {
      if ('provenance' in side) {
        conflicted.add(constraintIdentity(side as ProvenancedConstraint));
      }
    }
  }

  return constraints.map((constraint) => {
    if (conflicted.has(constraintIdentity(constraint)) && constraint.provenance !== 'DOCUMENTED') {
      return { ...constraint, provenance: 'CONFLICTED' as const, hardEligible: false };
    }
    // The absolute rule: only DOCUMENTED provenance may harden.
    return {
      ...constraint,
      hardEligible: constraint.provenance === 'DOCUMENTED' && constraint.confidence >= 0.8,
    };
  });
}

/**
 * Prompt-injection resistance: documentation is UNTRUSTED DATA. Scan
 * extracted text for instruction-shaped content and report it as findings —
 * the generator's behavior must never change because of document contents.
 */
export interface InjectionFinding {
  pattern: string;
  excerpt: string;
  path: string;
}

const INJECTION_PATTERNS: Array<{ name: string; regex: RegExp }> = [
  { name: 'ignore-instructions', regex: /ignore\s+(all\s+)?(previous|prior|above)\s+instructions/i },
  { name: 'disregard-safety', regex: /disregard\s+(all\s+)?(safety|policies|limits)/i },
  { name: 'system-prompt-override', regex: /you\s+are\s+now\s+(a|an)\s+/i },
  { name: 'reveal-secrets', regex: /reveal|print|expose\s+(your\s+)?(system\s+prompt|secrets|api\s+keys?)/i },
  { name: 'override-limits', regex: /set\s+(voltage|max|maximum)\s+to\s+\d{4,}/i },
  { name: 'tool-execution', regex: /execute\s+(the\s+following|this)\s+(command|tool|code)/i },
  { name: 'developer-mode', regex: /developer\s+mode\s+(enabled|activated)/i },
];

export function scanForPromptInjection(
  texts: Array<{ path: string; text: string }>,
): InjectionFinding[] {
  const findings: InjectionFinding[] = [];
  for (const { path, text } of texts) {
    for (const { name, regex } of INJECTION_PATTERNS) {
      const match = regex.exec(text);
      if (match) {
        findings.push({
          pattern: name,
          excerpt: text.slice(Math.max(0, match.index - 40), match.index + 80).replace(/\s+/g, ' ').trim(),
          path,
        });
      }
    }
  }
  return findings;
}

/**
 * Honest implementation states (spec v1). A generated TypeScript function
 * containing TODO does NOT mean IMPLEMENTED.
 */
export type ImplementationState = 'DISCOVERED' | 'MAPPED' | 'STUBBED' | 'IMPLEMENTED' | 'SIMULATED' | 'VERIFIED';

export function classifyImplementationState(options: {
  hasVendorCallMapping: boolean;
  generatedBodyHasTodo: boolean;
  generatedBodyThrowsExplicit: boolean;
  conformancePassed?: boolean;
  simulationPassed?: boolean;
  hardwareVerified?: boolean;
}): ImplementationState {
  if (options.hardwareVerified) return 'VERIFIED';
  if (options.simulationPassed) return 'SIMULATED';
  if (options.generatedBodyHasTodo) return 'STUBBED';
  if (options.generatedBodyThrowsExplicit) return 'STUBBED';
  if (options.hasVendorCallMapping && options.conformancePassed) return 'IMPLEMENTED';
  if (options.hasVendorCallMapping) return 'MAPPED';
  return 'DISCOVERED';
}
