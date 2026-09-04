# ADR 0002: One daemon control plane with thin clients

Status: Accepted

The daemon owns leases, operation execution, journal recovery, idempotency, and
the authoritative device registry. CLI, MCP, and Python clients call its HTTP
API instead of creating competing in-process control planes.

An embedded MCP server is retained for discovery and demonstrations. It
explicitly returns `CONTROL_PLANE_UNAVAILABLE` for lease or operation actions,
so it cannot accidentally imply production-grade coordination.

