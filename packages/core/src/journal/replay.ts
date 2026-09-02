/**
 * Session replay (spec v1).
 *
 * A recorded journal is a deterministic timeline of what the runtime decided
 * and did. Replay re-feeds entries in sequence order so sessions can be
 * debugged, diffed, used as regression fixtures, or driven into simulators.
 *
 * Recordings never contain secrets (the journal redacts before append) and
 * never contain raw binary payloads (oversized payloads are truncated at
 * journal time — replay sees the same truncation markers).
 */
import type { JournalEntry } from './journal.js';

export interface ReplayTimelineEntry {
  sequence: number;
  at: number;
  /** Milliseconds since the first entry of the recording. */
  offsetMs: number;
  kind: string;
  deviceId?: string;
  operationId?: string;
  summary: string;
}

export interface ReplaySession {
  startedAt: number;
  endedAt: number;
  durationMs: number;
  entryCount: number;
  devices: string[];
  kinds: Record<string, number>;
  timeline: ReplayTimelineEntry[];
}

/** Build a replay timeline from journal entries (sequence-ordered). */
export function buildReplaySession(entries: JournalEntry[]): ReplaySession {
  if (entries.length === 0) {
    return { startedAt: 0, endedAt: 0, durationMs: 0, entryCount: 0, devices: [], kinds: {}, timeline: [] };
  }
  const sorted = [...entries].sort((a, b) => a.sequence - b.sequence);
  const startedAt = sorted[0]!.at;
  const endedAt = sorted[sorted.length - 1]!.at;
  const devices = new Set<string>();
  const kinds: Record<string, number> = {};
  const timeline: ReplayTimelineEntry[] = [];

  for (const entry of sorted) {
    if (entry.deviceId) devices.add(entry.deviceId);
    kinds[entry.kind] = (kinds[entry.kind] ?? 0) + 1;
    timeline.push({
      sequence: entry.sequence,
      at: entry.at,
      offsetMs: entry.at - startedAt,
      kind: entry.kind,
      ...(entry.deviceId !== undefined ? { deviceId: entry.deviceId } : {}),
      ...(entry.operationId !== undefined ? { operationId: entry.operationId } : {}),
      summary: summarizeEntry(entry),
    });
  }

  return {
    startedAt,
    endedAt,
    durationMs: endedAt - startedAt,
    entryCount: sorted.length,
    devices: [...devices].sort(),
    kinds,
    timeline,
  };
}

function summarizeEntry(entry: JournalEntry): string {
  const payload = entry.payload ?? {};
  const bits: string[] = [];
  if (typeof payload.capability === 'string') bits.push(payload.capability);
  if (typeof payload.event === 'string') bits.push(payload.event);
  if (payload.decision && typeof payload.decision === 'object') {
    const decision = payload.decision as { code?: string };
    if (decision.code) bits.push(decision.code);
  }
  if (typeof payload.reason === 'string') bits.push(payload.reason);
  if (payload.error && typeof payload.error === 'object') {
    const error = payload.error as { code?: string };
    if (error.code) bits.push(error.code);
  }
  return bits.length > 0 ? bits.join(' ') : '';
}

export interface ReplayHandler {
  onEntry(entry: JournalEntry, context: { index: number; total: number; offsetMs: number }): void;
}

/**
 * Replay entries through a handler. `speed` scales the original timing:
 * 0 = as-fast-as-possible; 1 = real-time; 0.5 = double speed. Timing is
 * skipped entirely when `respectTiming` is false (default) — deterministic
 * and instant, which is what debugging wants.
 */
export async function replayJournal(
  entries: JournalEntry[],
  handler: ReplayHandler,
  options: { respectTiming?: boolean; speed?: number } = {},
): Promise<ReplaySession> {
  const session = buildReplaySession(entries);
  const respectTiming = options.respectTiming ?? false;
  const speed = options.speed ?? 1;

  for (let index = 0; index < session.timeline.length; index += 1) {
    const timelineEntry = session.timeline[index]!;
    if (respectTiming && index > 0) {
      const previous = session.timeline[index - 1]!;
      const delta = Math.max(0, (timelineEntry.at - previous.at) / speed);
      if (delta > 0) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(delta, 5000)));
      }
    }
    const entry = entries.find((candidate) => candidate.sequence === timelineEntry.sequence) ?? (entries[index] as JournalEntry);
    handler.onEntry(entry, {
      index,
      total: session.entryCount,
      offsetMs: timelineEntry.offsetMs,
    });
  }
  return session;
}

/** Format a replay session as human-readable text. */
export function formatReplaySession(session: ReplaySession): string[] {
  const lines: string[] = [];
  lines.push(`REPLAY: ${session.entryCount} entries over ${session.durationMs}ms`);
  lines.push(`DEVICES: ${session.devices.join(', ') || '(none)'}`);
  const kindSummary = Object.entries(session.kinds)
    .sort((a, b) => b[1] - a[1])
    .map(([kind, count]) => `${kind}×${count}`)
    .join(', ');
  lines.push(`KINDS: ${kindSummary}`);
  lines.push('TIMELINE:');
  for (const entry of session.timeline) {
    const device = entry.deviceId ? ` [${entry.deviceId}]` : '';
    const summary = entry.summary ? ` ${entry.summary}` : '';
    lines.push(`  +${String(entry.offsetMs).padStart(6)}ms #${entry.sequence} ${entry.kind}${device}${summary}`);
  }
  return lines;
}
