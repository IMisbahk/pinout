/**
 * Generic physical-evidence state contracts (spec v1).
 *
 * Models commanded, acknowledged, and independently observed state separately,
 * preventing software from inferring physical reality solely from a successful write.
 */

export type EvidenceSource =
  | 'commanded'
  | 'acknowledged'
  | 'gpio-readback'
  | 'sensor'
  | 'simulated'
  | 'none';

export type EvidenceProvenance = 'simulated' | 'hardware' | 'unknown';

export interface EvidenceValue<T = unknown> {
  value: T | null;
  at: string | null;
  source: EvidenceSource;
}

export interface EvidenceState<T = unknown> {
  commanded: EvidenceValue<T>;
  acknowledged: EvidenceValue<T>;
  observed: EvidenceValue<T>;
  freshnessMs: number | null;
  stale: boolean;
  provenance: EvidenceProvenance;
}

export interface StatePrerequisite {
  key: string;
  expectedValue?: unknown;
  maxAgeMs?: number;
}

export type DeviceStateEvidence = Record<string, EvidenceState<unknown>>;

export function formatIsoTimestamp(input?: string | number | Date | null): string {
  if (input === null || input === undefined) {
    return new Date().toISOString();
  }
  if (typeof input === 'string') {
    return input;
  }
  if (typeof input === 'number') {
    return new Date(input).toISOString();
  }
  return input.toISOString();
}

export function getTimestampMs(input?: string | number | Date | null): number {
  if (input === null || input === undefined) {
    return Date.now();
  }
  if (typeof input === 'number') {
    return input;
  }
  if (typeof input === 'string') {
    return new Date(input).getTime();
  }
  return input.getTime();
}

export function unknownEvidence<T = unknown>(
  provenance: EvidenceProvenance = 'unknown',
): EvidenceState<T> {
  return {
    commanded: { value: null, at: null, source: 'none' },
    acknowledged: { value: null, at: null, source: 'none' },
    observed: { value: null, at: null, source: 'none' },
    freshnessMs: null,
    stale: false,
    provenance,
  };
}

export function createEvidenceState<T = unknown>(
  initial?: Partial<EvidenceState<T>>,
): EvidenceState<T> {
  const defaultState = unknownEvidence<T>();
  return {
    commanded: initial?.commanded ?? defaultState.commanded,
    acknowledged: initial?.acknowledged ?? defaultState.acknowledged,
    observed: initial?.observed ?? defaultState.observed,
    freshnessMs: initial?.freshnessMs !== undefined ? initial.freshnessMs : defaultState.freshnessMs,
    stale: initial?.stale !== undefined ? initial.stale : defaultState.stale,
    provenance: initial?.provenance ?? defaultState.provenance,
  };
}

export function recordCommanded<T = unknown>(
  state: EvidenceState<T>,
  value: T | null,
  at?: string | number | Date | null,
  provenance?: EvidenceProvenance,
): EvidenceState<T> {
  const atIso = formatIsoTimestamp(at);
  return {
    ...state,
    commanded: {
      value,
      at: atIso,
      source: 'commanded',
    },
    ...(provenance !== undefined ? { provenance } : {}),
  };
}

export function recordAcknowledged<T = unknown>(
  state: EvidenceState<T>,
  value: T | null,
  at?: string | number | Date | null,
  provenance?: EvidenceProvenance,
): EvidenceState<T> {
  const atIso = formatIsoTimestamp(at);
  return {
    ...state,
    acknowledged: {
      value,
      at: atIso,
      source: 'acknowledged',
    },
    ...(provenance !== undefined ? { provenance } : {}),
  };
}

export function recordObserved<T = unknown>(
  state: EvidenceState<T>,
  value: T | null,
  source: 'gpio-readback' | 'sensor' | 'simulated' = 'sensor',
  at?: string | number | Date | null,
  provenance?: EvidenceProvenance,
  maxAgeMs?: number,
): EvidenceState<T> {
  const atIso = formatIsoTimestamp(at);
  const next: EvidenceState<T> = {
    ...state,
    observed: {
      value,
      at: atIso,
      source,
    },
    freshnessMs: 0,
    stale: false,
    ...(provenance !== undefined ? { provenance } : {}),
  };
  return computeFreshness(next, atIso, maxAgeMs);
}

export function computeFreshness<T = unknown>(
  state: EvidenceState<T>,
  now?: string | number | Date,
  maxAgeMs?: number,
): EvidenceState<T> {
  if (state.observed.at === null) {
    return {
      ...state,
      freshnessMs: null,
      stale: false,
    };
  }
  const nowMs = getTimestampMs(now);
  const obsMs = new Date(state.observed.at).getTime();
  if (Number.isNaN(obsMs)) {
    return {
      ...state,
      freshnessMs: null,
      stale: true,
    };
  }
  const freshnessMs = Math.max(0, nowMs - obsMs);
  const stale = maxAgeMs !== undefined ? freshnessMs > maxAgeMs : state.stale;
  return {
    ...state,
    freshnessMs,
    stale,
  };
}

export function isStale<T = unknown>(
  state: EvidenceState<T>,
  maxAgeMs: number,
  now?: string | number | Date,
): boolean {
  if (state.observed.at === null) {
    return true;
  }
  const nowMs = getTimestampMs(now);
  const obsMs = new Date(state.observed.at).getTime();
  if (Number.isNaN(obsMs)) {
    return true;
  }
  const ageMs = nowMs - obsMs;
  return ageMs > maxAgeMs || ageMs < 0;
}

export function hasObservedValue<T = unknown>(state: EvidenceState<T>): boolean {
  return state.observed.value !== null && state.observed.at !== null && state.observed.source !== 'none';
}
