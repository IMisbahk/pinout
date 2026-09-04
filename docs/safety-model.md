# Safety model

Pinout applies schema validation, capability policy, leases, operation
idempotency, stale-state checks, and journal records below an agent. The daemon
is the actuation authority and the CLI/MCP/Python surfaces are clients of that
control plane.

The normal pipeline is:

1. Discover and inspect capabilities (read-only).
2. Acquire a scoped lease for the physical capability.
3. Validate a request and run a non-actuating dry-run.
4. Start an idempotent operation with progress and an audit record.
5. Release the lease, or enter `HALTED` on emergency stop/fault.

Lease expiry, cancellation, and backend failure attempt a best-effort safe
rollback. A halt is a latched software state that requires an explicit reset;
it is not a substitute for a physical E-stop, current limit, interlock, or
watchdog.

Simulation, compile tests, and protocol acknowledgements do not establish
physical safety, certification, timing guarantees, or suitability for mains
loads. Hardware claims require a dated record under `hardware/records/`.
