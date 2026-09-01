import { describe, expect, it } from 'vitest';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import {
  FileJournalStorage,
  Journal,
  MemoryJournalStorage,
  redactPayload,
} from '../src/journal/journal.js';

describe('redactPayload', () => {
  it('strips credential-shaped keys', () => {
    const redacted = redactPayload({
      target: 42,
      password: 'hunter2',
      apiToken: 'abc',
      Authorization: 'Bearer xyz',
      nested: { secret_value: 1, ok: 2 },
    });
    expect(redacted.password).toBe('[REDACTED]');
    expect(redacted.apiToken).toBe('[REDACTED]');
    expect(redacted.Authorization).toBe('[REDACTED]');
    expect(redacted.target).toBe(42);
    expect((redacted.nested as Record<string, unknown>).secret_value).toBe('[REDACTED]');
    expect((redacted.nested as Record<string, unknown>).ok).toBe(2);
  });

  it('caps array payloads', () => {
    const redacted = redactPayload({ samples: Array.from({ length: 100 }, (_, i) => i) });
    expect((redacted.samples as unknown[]).length).toBe(32);
  });
});

describe('Journal', () => {
  it('appends entries with monotonically increasing sequence numbers', () => {
    const journal = new Journal();
    const a = journal.append('invocation.requested', { deviceId: 'arm-01' }, { capability: 'motion.home' });
    const b = journal.append('operation.started', { deviceId: 'arm-01', operationId: a.payload?.capability as string });
    expect(a.sequence).toBe(1);
    expect(b.sequence).toBe(2);
  });

  it('filters by device, kind, and sequence', () => {
    const journal = new Journal();
    journal.append('invocation.requested', { deviceId: 'arm-01' }, {});
    journal.append('invocation.requested', { deviceId: 'chamber-01' }, {});
    journal.append('policy.rejected', { deviceId: 'arm-01' }, {});

    expect(journal.query({ deviceId: 'arm-01' })).resolves.toHaveLength(2);
    expect(
      journal.query({ kinds: ['policy.rejected'] }).then((entries) => entries[0].deviceId),
    ).resolves.toBe('arm-01');
    expect(journal.query({ afterSequence: 2 })).resolves.toHaveLength(1);
  });

  it('redacts secrets before they reach storage', async () => {
    const storage = new MemoryJournalStorage();
    const journal = new Journal({ storage });
    journal.append('invocation.requested', { deviceId: 'd' }, { token: 'super-secret', timeoutMs: 5 });
    const stored = storage.readAll()[0];
    expect(JSON.stringify(stored)).not.toContain('super-secret');
    expect(stored.payload?.token).toBe('[REDACTED]');
    expect(stored.payload?.timeoutMs).toBe(5);
  });

  it('truncates oversized payloads', () => {
    const journal = new Journal({ maxPayloadChars: 100 });
    const entry = journal.append('event.emitted', { deviceId: 'd' }, { blob: 'x'.repeat(5000) });
    expect(entry.payload?.truncated).toBe(true);
    expect(entry.payload?.originalChars).toBeGreaterThan(100);
  });

  it('persists to a JSONL file and replays', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pinout-journal-'));
    const filePath = join(dir, 'session.pinout-journal');
    const journal = new Journal({ storage: new FileJournalStorage(filePath) });
    journal.append('invocation.requested', { deviceId: 'arm-01' }, { capability: 'motion.home' });
    journal.append('invocation.completed', { deviceId: 'arm-01' }, { ok: true });
    await journal.close();

    const text = await readFile(filePath, 'utf8');
    expect(text.split('\n').filter((l) => l.trim())).toHaveLength(2);

    const entries = await new Journal({ storage: new FileJournalStorage(filePath) }).query();
    expect(entries.map((e) => e.kind)).toEqual(['invocation.requested', 'invocation.completed']);
    expect(entries[1].payload?.ok).toBe(true);

    await rm(dir, { recursive: true, force: true });
  });

  it('continues sequence numbering after hydration', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'pinout-journal-'));
    const filePath = join(dir, 'journal.jsonl');
    const first = new Journal({ storage: new FileJournalStorage(filePath) });
    first.append('device.connected', { deviceId: 'd' });
    first.append('device.connected', { deviceId: 'd' });
    await first.close();

    const second = new Journal({ storage: new FileJournalStorage(filePath) });
    expect(await second.hydrate()).toBe(2);
    const entry = second.append('device.disconnected', { deviceId: 'd' });
    expect(entry.sequence).toBe(3);

    await rm(dir, { recursive: true, force: true });
  });
});
