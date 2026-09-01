# Leases

Multiple agents and programs may try to control the same machine. Leases give
one owner deterministic permission to issue capabilities in their scope while
everyone else can still read
(`packages/core/src/lease/leaseManager.ts`).

## Modes and scopes

- **Modes:** `exclusive` (blocks everyone else) and `shared-read`
  (concurrent readers allowed; writers blocked).
- **Scopes:** device-wide (`{ kind: 'device', deviceId }`) or
  capability-scoped (`{ kind: 'capability', deviceId, capabilities }`).
  A capability-scoped lease on `motion.*` leaves `gripper.*` free.

## TTLs

Every lease has a TTL (default 60 s) with `renew()` and `release()`. Expired
leases are reaped on contact — a crashed agent cannot hold a machine forever.

## Enforcement

Enforcement lives in the policy layer, not the backend: a `lease` safety rule
(`packages/core/src/policy/safety.ts`) requires the caller (`owner`) to hold
an active lease covering the device+capability. The daemon wires this up for
API invocations; the Python/TS SDKs pass `owner` with requests.

## Errors

- `LEASE_CONFLICT` — acquiring over a conflicting active lease
- `LEASE_NOT_OWNER` — renew/release by a non-owner
- `LEASE_EXPIRED` — renewing an expired lease (retryable: re-acquire)
- `SAFETY_LEASE_REQUIRED` — invoking a lease-gated capability without holding one
