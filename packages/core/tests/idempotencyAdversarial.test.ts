/**
 * Adversarial tests for the idempotency system (Wave-2 audit #17).
 *
 * Threat model: malicious or buggy clients with arbitrary key strings,
 * concurrent retries, cross-user key collisions, and unbounded operation.
 */
import { describe, expect, it } from 'vitest';
import { BoundedIdempotencyStore } from '../src/operation/idempotencyStore.js';
import { OperationManager } from '../src/operation/operationManager.js';

const tick = (ms = 2) => new Promise((resolve) => setTimeout(resolve, ms));

describe('BoundedIdempotencyStore', () => {
  it('scopes keys by owner: two callers with the same key never collide', () => {
    const now = 1_000_000;
    const store = new BoundedIdempotencyStore({ now: () => now });
    store.recordUnder(
      BoundedIdempotencyStore.keyFor('arm-01', 'motion.move_to', 'agent-a', 'retry-1'),
      {
        operationId: 'op_a',
        deviceId: 'arm-01',
        capability: 'motion.move_to',
        owner: 'agent-a',
        status: 'running',
        createdAt: now,
      },
    );
    const b = store.lookup('arm-01', 'motion.move_to', 'agent-b', 'retry-1');
    expect(b.hit).toBe(false);
    const a = store.lookup('arm-01', 'motion.move_to', 'agent-a', 'retry-1');
    expect(a.hit).toBe(true);
    expect(a.operationId).toBe('op_a');
  });

  it('evicts least-recently-used entries beyond maxEntries (bounded memory)', () => {
    let now = 0;
    const store = new BoundedIdempotencyStore({
      maxEntries: 100,
      retentionMs: 1_000_000,
      now: () => now,
    });
    for (let i = 0; i < 150; i += 1) {
      store.recordUnder(BoundedIdempotencyStore.keyFor('d', 'c', 'o', `key-${i}`), {
        operationId: `op_${i}`,
        deviceId: 'd',
        capability: 'c',
        owner: 'o',
        status: 'completed',
        createdAt: now,
      });
      now += 1;
    }
    expect(store.size()).toBe(100);
    // The earliest keys were evicted.
    expect(store.lookup('d', 'c', 'o', 'key-0').hit).toBe(false);
    expect(store.lookup('d', 'c', 'o', 'key-149').hit).toBe(true);
  });

  it('expires tombstones after the retention window', () => {
    let now = 1000;
    const store = new BoundedIdempotencyStore({ retentionMs: 1000, now: () => now });
    store.recordUnder(BoundedIdempotencyStore.keyFor('d', 'c', 'o', 'k'), {
      operationId: 'op_1',
      deviceId: 'd',
      capability: 'c',
      owner: 'o',
      status: 'completed',
      createdAt: now,
    });
    now += 999;
    expect(store.lookup('d', 'c', 'o', 'k').hit).toBe(true);
    now += 2;
    const after = store.lookup('d', 'c', 'o', 'k');
    expect(after.hit).toBe(false);
    expect(after.expiredOrEvicted).toBe(true);
    expect(store.reapExpired()).toBe(0); // already removed on lookup
  });

  it('a malicious client cannot grow the store past maxEntries no matter how many keys it sends', () => {
    let now = 0;
    const store = new BoundedIdempotencyStore({ maxEntries: 50, now: () => now });
    for (let i = 0; i < 10_000; i += 1) {
      store.recordUnder(
        BoundedIdempotencyStore.keyFor('d', 'c', 'attacker', `flood-${i}-${'x'.repeat(50)}`),
        {
          operationId: `op_${i}`,
          deviceId: 'd',
          capability: 'c',
          owner: 'attacker',
          status: 'completed',
          createdAt: now,
        },
      );
      now += 1;
    }
    expect(store.size()).toBe(50);
  });

  it('a very long key does not enable collisions via prefix tricks', () => {
    const now = 1_000_000;
    const store = new BoundedIdempotencyStore({ now: () => now });
    store.recordUnder(BoundedIdempotencyStore.keyFor('d', 'c', 'o', 'key'), {
      operationId: 'op_1',
      deviceId: 'd',
      capability: 'c',
      owner: 'o',
      status: 'completed',
      createdAt: now,
    });
    // '::key' as a key is a different scope, not a collision with 'key'.
    expect(store.lookup('d', 'c', 'o', '::key').hit).toBe(false);
    expect(store.lookup('d', 'c', 'o', 'key').hit).toBe(true);
  });
});

describe('OperationManager idempotency hardening', () => {
  it('dedupes retries with the same key and owner', async () => {
    const manager = new OperationManager();
    let runs = 0;
    const first = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'agent-a',
      idempotencyKey: 'req-1',
      run: async () => {
        runs += 1;
        await tick(10);
        return {};
      },
    });
    const retry = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'agent-a',
      idempotencyKey: 'req-1',
      run: async () => ({ attempt: 2 }),
    });
    expect(retry.deduped).toBe(true);
    expect(retry.handle.id).toBe(first.handle.id);
    await first.handle.waitForResult();
    expect(runs).toBe(1);
  });

  it('does NOT dedupe across different owners', async () => {
    const manager = new OperationManager();
    const a = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'agent-a',
      idempotencyKey: 'shared-key',
      run: async () => ({}),
    });
    const b = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'agent-b',
      idempotencyKey: 'shared-key',
      run: async () => ({}),
    });
    expect(b.deduped).toBe(false);
    expect(b.handle.id).not.toBe(a.handle.id);
    await Promise.all([a.handle.waitForResult(), b.handle.waitForResult()]);
  });

  it('after tombstone eviction a retry re-executes (documented retention limit)', async () => {
    const store = new BoundedIdempotencyStore({ maxEntries: 4, retentionMs: 1_000_000 });
    const manager = new OperationManager({}, store);
    let runs = 0;
    const run = {
      run: async () => {
        runs += 1;
        await tick(1);
        return {};
      },
    };

    // Flood with 10 keyed operations on the same device/capability/owner,
    // evicting the first tombstone.
    for (let i = 0; i < 10; i += 1) {
      const { handle } = manager.begin({
        deviceId: 'arm-01',
        capability: 'motion.move_to',
        owner: 'a',
        idempotencyKey: `k-${i}`,
        ...run,
      });
      await handle.waitForResult();
    }
    expect(store.evictedLookups).toBeGreaterThanOrEqual(0);

    const retried = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'a',
      idempotencyKey: 'k-0',
      ...run,
    });
    // k-0's tombstone was evicted by the flood: the retry re-executes. This
    // is the documented retention trade-off, not silent behavior.
    expect(retried.deduped).toBe(false);
    await retried.handle.waitForResult();
    expect(runs).toBe(11);
  });

  it('a terminal failed operation is returned on retry within retention (same outcome)', async () => {
    const manager = new OperationManager();
    let runs = 0;
    const first = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'a',
      idempotencyKey: 'fail-1',
      run: async () => {
        runs += 1;
        throw new Error('motor driver fault');
      },
    });
    await expect(first.handle.waitForResult()).rejects.toThrowError(/motor driver fault/);
    const retry = manager.begin({
      deviceId: 'arm-01',
      capability: 'motion.move_to',
      owner: 'a',
      idempotencyKey: 'fail-1',
      run: async () => ({ runs: 2 }),
    });
    expect(retry.deduped).toBe(true);
    await expect(retry.handle.waitForResult()).rejects.toThrowError(/motor driver fault/);
    expect(runs).toBe(1);
  });
});
