import { describe, expect, it } from 'vitest';
import { buildReplaySession, formatReplaySession, replayJournal } from '@pinout/core';
import type { JournalEntry } from '@pinout/core';

function entry(sequence: number, at: number, kind: string, deviceId?: string, payload?: Record<string, unknown>): JournalEntry {
  return {
    sequence,
    at,
    kind: kind as JournalEntry['kind'],
    ...(deviceId !== undefined ? { deviceId } : {}),
    ...(payload ? { payload } : {}),
  };
}

describe('replay session', () => {
  const entries: JournalEntry[] = [
    entry(1, 1000, 'invocation.requested', 'arm-01', { capability: 'motion.move_to' }),
    entry(2, 1050, 'operation.started', 'arm-01', {}),
    entry(3, 1100, 'policy.rejected', 'bench-psu', { decision: { code: 'POLICY_CONSTRAINT_VIOLATION' }, capability: 'voltage.set' }),
    entry(4, 1200, 'operation.completed', 'arm-01', {}),
  ];

  it('builds a timeline with offsets and kind counts', () => {
    const session = buildReplaySession(entries);
    expect(session.entryCount).toBe(4);
    expect(session.durationMs).toBe(200);
    expect(session.devices).toEqual(['arm-01', 'bench-psu']);
    expect(session.kinds['operation.completed']).toBe(1);
    expect(session.timeline[2]!.offsetMs).toBe(100);
    expect(session.timeline[2]!.summary).toContain('POLICY_CONSTRAINT_VIOLATION');
  });

  it('handles empty recordings', () => {
    const session = buildReplaySession([]);
    expect(session.entryCount).toBe(0);
    expect(session.timeline).toHaveLength(0);
  });

  it('replays entries in sequence order through a handler', async () => {
    const seen: number[] = [];
    const session = await replayJournal(entries, {
      onEntry: (entry, context) => {
        seen.push(entry.sequence);
        expect(context.total).toBe(4);
      },
    });
    expect(seen).toEqual([1, 2, 3, 4]);
    expect(session.durationMs).toBe(200);
  });

  it('respects timing when asked (scaled)', async () => {
    const started = Date.now();
    await replayJournal([entry(1, 0, 'device.connected'), entry(2, 30, 'event.emitted')], { onEntry: () => undefined }, { respectTiming: true });
    const elapsed = Date.now() - started;
    expect(elapsed).toBeGreaterThanOrEqual(20);
  });

  it('formats a human-readable session', () => {
    const lines = formatReplaySession(buildReplaySession(entries));
    const text = lines.join('\n');
    expect(text).toContain('REPLAY: 4 entries over 200ms');
    expect(text).toContain('policy.rejected×1');
    expect(text).toContain('[bench-psu]');
  });

  it('never includes secret-shaped payload keys in summaries', () => {
    const secretEntry = entry(1, 0, 'invocation.requested', 'd', { capability: 'x', token: 'super-secret-value' });
    const session = buildReplaySession([secretEntry]);
    expect(JSON.stringify(session)).not.toContain('super-secret-value');
  });
});
