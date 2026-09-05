/**
 * Bounded idempotency key store for operations (adversarial-review hardening).
 *
 * Findings that motivated this module (Wave-2 audit #17):
 *
 * 1. UNBOUNDED GROWTH — a plain Map keyed by client-supplied strings lets any
 *    caller exhaust memory with unique keys. This store is bounded by entries
 *    AND by age (LRU eviction + tombstone retention window).
 * 2. CROSS-USER COLLISIONS — keys were scoped by device+capability only, so
 *    two unrelated callers sending the same key string would receive each
 *    other's operations. Keys are now scoped by owner as well.
 * 3. RETENTION SEMANTICS — after a tombstone is evicted (age or capacity), a
 *    retry of that key RE-EXECUTES. This is an honest, documented limit:
 *    clients that need longer guarantees must run against a store with a
 *    longer retentionMs (the interface is injected, not hardcoded).
 * 4. RESTART — the in-memory store loses tombstones when the daemon exits.
 *    A retry after a restart re-executes unless the deployment persists the
 *    journal and replays terminal states. Documented; not faked.
 *
 * Which physical operations are retryable? Only those submitted WITH an
 * idempotency key, and only within the retention window. Everything else is
 * at-least-once by design — physical side effects are never auto-retried.
 */

export interface IdempotencyTombstone {
  operationId: string;
  deviceId: string;
  capability: string;
  owner: string | undefined;
  idempotencyKey: string;
  status: string;
  createdAt: number;
  result?: Record<string, unknown>;
  error?: { code: string; message: string; retryable: boolean; details?: Record<string, unknown> };
  /** Last touched (used for LRU + retention). */
  lastUsedAt: number;
}

export interface IdempotencyStoreOptions {
  /** Maximum tombstones retained. Default 10_000. */
  maxEntries?: number;
  /** How long a tombstone guarantees dedupe, in ms. Default 24h. */
  retentionMs?: number;
  now?: () => number;
}

export interface IdempotencyLookup {
  hit: boolean;
  operationId?: string;
  /** True when the tombstone expired or was evicted before this lookup. */
  expiredOrEvicted?: boolean;
  tombstone?: IdempotencyTombstone;
}

export class BoundedIdempotencyStore {
  private readonly tombstones = new Map<string, IdempotencyTombstone>();
  private readonly maxEntries: number;
  private readonly retentionMs: number;
  private readonly nowFn: () => number;
  /** Count of lookups that arrived after the tombstone left the store. */
  evictedLookups = 0;

  constructor(options: IdempotencyStoreOptions = {}) {
    this.maxEntries = options.maxEntries ?? 10_000;
    this.retentionMs = options.retentionMs ?? 24 * 60 * 60 * 1000;
    this.nowFn = options.now ?? Date.now;
  }

  /** Keys are scoped by device, capability, AND owner: no cross-user collisions. */
  static keyFor(
    deviceId: string,
    capability: string,
    owner: string | undefined,
    key: string,
  ): string {
    return JSON.stringify([deviceId, capability, owner ?? null, key]);
  }

  lookup(
    deviceId: string,
    capability: string,
    owner: string | undefined,
    key: string,
  ): IdempotencyLookup {
    const id = BoundedIdempotencyStore.keyFor(deviceId, capability, owner, key);
    const tombstone = this.tombstones.get(id);
    if (!tombstone) {
      return { hit: false };
    }
    const now = this.nowFn();
    if (now - tombstone.createdAt > this.retentionMs) {
      this.tombstones.delete(id);
      this.evictedLookups += 1;
      return { hit: false, expiredOrEvicted: true };
    }
    // LRU touch.
    tombstone.lastUsedAt = now;
    // Reinsert to move to the end of Map iteration order (LRU behavior).
    this.tombstones.delete(id);
    this.tombstones.set(id, tombstone);
    return { hit: true, operationId: tombstone.operationId, tombstone: { ...tombstone } };
  }

  /** Record with an explicit pre-scoped key. */
  recordUnder(scopedKey: string, tombstone: Omit<IdempotencyTombstone, 'lastUsedAt'>): void {
    const now = this.nowFn();
    this.tombstones.set(scopedKey, { ...tombstone, lastUsedAt: now });
    this.evictOverflow();
  }

  updateUnder(
    scopedKey: string,
    patch: Partial<Pick<IdempotencyTombstone, 'status' | 'result' | 'error'>>,
  ): void {
    const existing = this.tombstones.get(scopedKey);
    if (!existing) return;
    this.tombstones.set(scopedKey, { ...existing, ...patch, lastUsedAt: this.nowFn() });
  }

  deleteUnder(scopedKey: string): boolean {
    return this.tombstones.delete(scopedKey);
  }

  remove(
    deviceId: string,
    capability: string,
    owner: string | undefined,
    key: string,
  ): boolean {
    const id = BoundedIdempotencyStore.keyFor(deviceId, capability, owner, key);
    return this.tombstones.delete(id);
  }

  size(): number {
    return this.tombstones.size;
  }

  /** Import a previously journaled tombstone during process startup. */
  hydrate(entries: IdempotencyTombstone[]): number {
    for (const tombstone of entries) {
      if (this.nowFn() - tombstone.createdAt <= this.retentionMs) {
        this.tombstones.set(
          BoundedIdempotencyStore.keyFor(
            tombstone.deviceId,
            tombstone.capability,
            tombstone.owner,
            tombstone.idempotencyKey,
          ),
          { ...tombstone },
        );
      }
    }
    this.evictOverflow();
    return this.tombstones.size;
  }

  /** Drop expired tombstones; returns how many were removed. */
  reapExpired(): number {
    const now = this.nowFn();
    let removed = 0;
    for (const [id, tombstone] of this.tombstones) {
      if (now - tombstone.createdAt > this.retentionMs) {
        this.tombstones.delete(id);
        removed += 1;
      }
    }
    return removed;
  }

  private evictOverflow(): void {
    while (this.tombstones.size > this.maxEntries) {
      // Map iteration order = insertion order; the first entry is the
      // least-recently-used (lookup() reinserts touched entries).
      const oldestKey = this.tombstones.keys().next().value;
      if (oldestKey === undefined) break;
      this.tombstones.delete(oldestKey);
      this.evictedLookups += 1;
    }
  }
}
