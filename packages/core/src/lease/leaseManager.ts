/**
 * Resource leases (spec v1).
 *
 * Multiple agents may try to control the same machine. A lease gives one
 * owner deterministic permission to issue capabilities in its scope, while
 * everyone else may still read. Leases have TTLs: a crashed agent cannot hold
 * a machine forever — expiry is checked lazily and on demand.
 *
 * Lease enforcement is integrated at the policy layer (`leasePolicy` in
 * `policy/policiesV2.ts`), not inside the backend.
 */
import { PinoutStructuredError } from '../errors.js';
import type { Lease, LeaseMode } from '../spec/types.js';

export type { Lease, LeaseMode };

export type LeaseScopeInput =
  | { kind: 'device'; deviceId: string }
  | { kind: 'capability'; deviceId: string; capabilities: string[] };

export interface AcquireLeaseOptions {
  scope: LeaseScopeInput;
  owner: string;
  /** Lease TTL in milliseconds. Default 60_000. */
  ttlMs?: number;
  mode?: LeaseMode;
  /** If false, acquiring over a conflicting active lease throws. Default true. */
  wait?: boolean;
}

export interface LeaseConflictDetails {
  leaseId: string;
  owner: string;
  expiresAt: number;
  scope: LeaseScopeInput;
}

const DEFAULT_TTL_MS = 60_000;

export class LeaseManager {
  private readonly leases = new Map<string, Lease>();
  private sequence = 0;
  private readonly nowFn: () => number;

  constructor(options: { now?: () => number } = {}) {
    this.nowFn = options.now ?? Date.now;
  }

  /**
   * Acquire a lease. Exclusive mode conflicts with any overlapping active
   * lease on the same scope; shared-read conflicts only with exclusive
   * leases. Expired leases never conflict — they are reaped on contact.
   */
  acquire(options: AcquireLeaseOptions): Lease {
    this.reapExpired();
    const mode = options.mode ?? 'exclusive';

    for (const lease of this.leases.values()) {
      if (!this.scopesOverlap(lease, options.scope)) continue;
      if (lease.mode === 'exclusive' || mode === 'exclusive') {
        throw new PinoutStructuredError('LEASE_CONFLICT', 'LEASE', `Resource is leased by '${lease.owner}' until lease expiry.`, {
          details: {
            conflictingLeaseId: lease.id,
            owner: lease.owner,
            expiresAt: lease.expiresAt,
          } as Record<string, unknown>,
        });
      }
    }

    const now = this.nowFn();
    const lease: Lease = {
      id: `lease_${++this.sequence}_${Math.random().toString(36).slice(2, 8)}`,
      mode,
      scope: options.scope,
      owner: options.owner,
      createdAt: now,
      expiresAt: now + (options.ttlMs ?? DEFAULT_TTL_MS),
      renewable: true,
    };
    this.leases.set(lease.id, lease);
    return { ...lease };
  }

  /** Renew a lease you own. Expired leases cannot be renewed. */
  renew(leaseId: string, owner: string, ttlMs = DEFAULT_TTL_MS): Lease {
    const lease = this.leases.get(leaseId);
    if (!lease || this.isExpired(lease)) {
      this.leases.delete(leaseId);
      throw new PinoutStructuredError('LEASE_EXPIRED', 'LEASE', `Lease '${leaseId}' is expired or unknown.`, {
        retryable: true,
      });
    }
    if (lease.owner !== owner) {
      throw new PinoutStructuredError('LEASE_NOT_OWNER', 'AUTH', `Lease '${leaseId}' belongs to '${lease.owner}'.`);
    }
    lease.expiresAt = this.nowFn() + ttlMs;
    return { ...lease };
  }

  /** Release a lease you own. Unknown or foreign leases are not released silently. */
  release(leaseId: string, owner: string): void {
    const lease = this.leases.get(leaseId);
    if (!lease) return;
    if (lease.owner !== owner) {
      throw new PinoutStructuredError('LEASE_NOT_OWNER', 'AUTH', `Lease '${leaseId}' belongs to '${lease.owner}'.`);
    }
    this.leases.delete(leaseId);
  }

  /** Drop a lease regardless of owner (runtime/admin use). */
  forceRelease(leaseId: string): void {
    this.leases.delete(leaseId);
  }

  get(leaseId: string): Lease | undefined {
    const lease = this.leases.get(leaseId);
    if (!lease) return undefined;
    if (this.isExpired(lease)) {
      this.leases.delete(leaseId);
      return undefined;
    }
    return { ...lease };
  }

  list(filter: { owner?: string; deviceId?: string } = {}): Lease[] {
    this.reapExpired();
    const out: Lease[] = [];
    for (const lease of this.leases.values()) {
      if (filter.owner && lease.owner !== filter.owner) continue;
      if (filter.deviceId && !leaseCoversDevice(lease, filter.deviceId)) continue;
      out.push({ ...lease });
    }
    return out;
  }

  /**
   * Whether `owner` holds an active lease permitting `mode` access on
   * `deviceId` (and `capability` when the lease is capability-scoped).
   */
  permits(
    owner: string,
    deviceId: string,
    capability: string,
    mode: LeaseMode = 'exclusive',
  ): { permitted: boolean; conflict?: LeaseConflictDetails } {
    this.reapExpired();
    for (const lease of this.leases.values()) {
      if (!leaseCoversDevice(lease, deviceId)) continue;
      if (lease.scope.kind === 'capability' && !lease.scope.capabilities.includes(capability)) {
        continue;
      }
      // A lease in scope of this capability exists. Does it block us?
      if (lease.owner === owner) continue;
      if (mode === 'shared-read' && lease.mode === 'shared-read') continue;
      return {
        permitted: false,
        conflict: {
          leaseId: lease.id,
          owner: lease.owner,
          expiresAt: lease.expiresAt,
          scope: lease.scope,
        },
      };
    }
    return { permitted: true };
  }

  /** Remove all expired leases; returns how many were reaped. */
  reapExpired(): number {
    let reaped = 0;
    for (const [id, lease] of this.leases) {
      if (this.isExpired(lease)) {
        this.leases.delete(id);
        reaped += 1;
      }
    }
    return reaped;
  }

  private isExpired(lease: Lease): boolean {
    return lease.expiresAt <= this.nowFn();
  }

  private scopesOverlap(a: Lease, b: LeaseScopeInput): boolean {
    if (!leaseCoversDevice(a, b.deviceId)) return false;
    if (b.kind === 'device') return true;
    if (a.scope.kind === 'device') return true;
    return b.capabilities.some((capability) => a.scope.capabilities.includes(capability));
  }
}

function leaseCoversDevice(lease: Lease, deviceId: string): boolean {
  return lease.scope.deviceId === deviceId;
}
