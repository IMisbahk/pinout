# ADR 0001: Governed runtime as the only production control path

Status: Accepted

Pinout production actions run through `PinoutRuntime` and `DeviceInstance`,
which enforce capability policy, leases, idempotency, stale-state checks, and
safe rollback. Direct transport or `Device.invoke` calls remain available to
low-level adapters and tests, but are not a supported production control path.

This keeps every public surface (CLI, daemon, MCP, and SDK integrations) on the
same safety and audit pipeline while preserving a small protocol/transport core.

