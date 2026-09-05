# Security model

The alpha daemon is intended for loopback use. Tokens, journal data, and module
inputs can be sensitive; keep the journal directory owner-readable and do not
expose the HTTP listener directly to an untrusted network.

Authentication tokens identify a caller but do not turn a device into a secure
boundary. Leases are authorization to coordinate a capability, not proof that
the caller is safe to operate the attached equipment. Idempotency keys prevent
duplicate actuation after retries, while audit records support diagnosis.

Process isolation for modules is not a security sandbox. Remote access, TLS,
scoped tokens, trusted signing, and a hardened module sandbox are not alpha
claims. See [SECURITY.md](../SECURITY.md) for vulnerability reporting.

## Client access boundary and route governance

Pinout separates client access into two tiers:

1. **Governed control plane (production / agent boundary)**:
   All autonomous agents and multi-client workflows connect through `pinoutd` over HTTP (or the MCP daemon adapter / Python SDK). The daemon enforces authentication tokens, multi-agent lease arbitration, safety engine rules, operation idempotency, and an append-only audit journal.

2. **Direct low-level developer access**:
   Direct Node.js `@pinout/core` SDK calls and developer CLI commands (`pinout exec`, `pinout gpio *`, `pinout module test`) run in-process against local hardware or simulators. Direct access intentionally bypasses cross-process lease enforcement and the centralized audit journal to enable unencumbered driver testing and bring-up (see [Architecture](architecture.md#intentional-low-level-sdk-access)). Production agent deployments must never expose raw serial or direct SDK access to unvetted LLM tools.
