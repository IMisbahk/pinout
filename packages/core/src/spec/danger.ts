/**
 * Canonical danger classification for capabilities.
 *
 * Descriptive metadata only. Enforcement stays in the policy engine; this
 * classification tells agents, UIs, and permission systems what to treat
 * carefully — it must never be the sole safety mechanism.
 */
export type { DangerLevel } from './types.js';

import type { DangerLevel } from './types.js';

export const DANGER_LEVELS: readonly DangerLevel[] = [
  'READ_ONLY',
  'LOW_RISK',
  'PHYSICAL_SIDE_EFFECT',
  'HIGH_RISK',
];

/** Rank ordering so tooling can require stricter handling above a threshold. */
export function dangerRank(level: DangerLevel): number {
  return DANGER_LEVELS.indexOf(level);
}

/** True when a capability above `threshold` (inclusive) should demand a lease. */
export function requiresLease(
  level: DangerLevel,
  threshold: DangerLevel = 'PHYSICAL_SIDE_EFFECT',
): boolean {
  return dangerRank(level) >= dangerRank(threshold);
}
