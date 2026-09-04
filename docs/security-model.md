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
