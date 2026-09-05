# ADR 0006: Explicit boundaries between daemon governance and direct SDK access

Status: Accepted

## Context

Pinout provides multiple client access routes:
1. CLI (`packages/cli`)
2. Python SDK (`sdk/python`)
3. Model Context Protocol adapter (`packages/mcp`)
4. Direct Node.js `@pinout/core` SDK usage (`packages/core`)

Autonomous AI agents and multi-client deployments require strict, externalized physical governance: bearer authentication tokens, multi-agent lease arbitration, capability policy and schema validation, persistent operation journaling, and a centralized software halt and emergency-stop latch. Conversely, driver developers and automated test harnesses require fast, low-overhead, in-process access for hardware bring-up, unit testing, and simulation without managing a background daemon process.

## Decision

1. **Authoritative daemon control plane**: `pinoutd` is the authoritative control plane for all production, multi-agent, and agentic tool execution. The default MCP stdio adapter, the Python SDK (sync and async), and CLI daemon commands route through `pinoutd` over its local HTTP API.
2. **Intentional direct SDK access**: Direct `@pinout/core` usage (via `connect()`, `new PinoutRuntime()`, or direct CLI hardware commands like `pinout exec` and `pinout gpio *`) is explicitly retained as an intentional developer surface for driver authoring (`defineModule()`, `pinout module test`), offline simulator testing (`simulatedEsp32()`, loopback transports), and board bring-up.
3. **Explicit bypass semantics**: Direct `@pinout/core` access executes in-process and enforces local input/output schema validation and module policies, but intentionally bypasses cross-process lease enforcement, daemon-wide halt latches, centralized audit journaling, and operation idempotency. Production agent workflows must never use direct SDK access.
4. **Consistent client conventions**: Client routes consistently support unified environment variables (`PINOUT_DAEMON_URL` with fallback to `PINOUT_URL`, `PINOUT_TOKEN`, and `PINOUT_OWNER`) and structured error mapping (`DAEMON_UNREACHABLE`).

## Consequences

- Physical safety rules and lease ownership are enforced outside LLM control in production agent workflows.
- Hardware module developers retain lightweight ergonomics for testing and development without daemon overhead.
- The system topology clearly delineates what guarantees apply to each access route and what guarantees are bypassed by direct access.
