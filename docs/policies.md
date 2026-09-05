# Pinout policies

Physical safety and preconditions are enforced **outside** LLM/agent control, in the Pinout runtime, before a capability reaches the device backend.

## Invocation pipeline

```text
invoke(deviceId, capability, input)
      │
      ▼
capability present on device?
      │
      ▼
JSON Schema validation (capability inputSchema)
      │
      ▼
module policy rules (numeric bounds, state preconditions, workspace)
      │
      ▼
device backend (protocol / simulator / firmware)
```

Agents and MCP tools cannot bypass this chain. They only call `runtime.invoke()` with structured payloads.

## Policy kinds (v1)

| Kind | Example |
| --- | --- |
| `numericRange` | `temperature.set` value 10–80 °C |
| `stateEquals` | `experiment.start` requires `door == closed` |
| `workspaceBounds` | `motion.move_to` x/y/z workspace limits |
| `custom` | Module-specific checks |

## Error codes

| Code | Meaning |
| --- | --- |
| `POLICY_CONSTRAINT_VIOLATION` | Numeric or workspace limit exceeded |
| `POLICY_PRECONDITION_FAILED` | Required operational state not met |
| `POLICY_ACTION_DENIED` | Action blocked by policy (reserved) |

Errors include structured `metadata` (device id, capability, field, bounds) without leaking secrets.

## ESP32 hardware rules

ESP32 flash pins, UART0, input-only pins, and strap pins are still validated in the SDK `Device` layer when using protocol transports. Module policies for `pinout/esp32` are empty because those rules already live in the ESP32 driver — they remain unchanged for backward compatibility.

## Chamber example

```ts
// Rejected before simulator:
await runtime.invoke('chamber-sim-01', 'temperature.set', { value: 200 });
// → POLICY_CONSTRAINT_VIOLATION

await runtime.invoke('chamber-sim-01', 'door.open', {});
await runtime.invoke('chamber-sim-01', 'experiment.start', {});
// → POLICY_PRECONDITION_FAILED (door open)
```

## Robot arm example

```ts
// Rejected before simulator:
await runtime.invoke('arm-sim-01', 'motion.move_to', { x: 2, y: 0, z: 0.5 });
// → POLICY_CONSTRAINT_VIOLATION (x outside [-1, 1])
```

Policies run against the device **operational state** snapshot at invoke time (door status, arm pose metadata, etc.).

## Daemon safety engine (v2 rules)

When invocations run through `pinoutd`, the daemon layers its centralized `SafetyEngine` around the runtime pipeline:

1. **Lease verification**: Enforces that physical-output capabilities are held by an active exclusive or shared lease for the declaring `owner`.
2. **Approval tokens**: Verifies single-use or time-bounded approval tokens (`POST /v1/approvals`) for high-consequence operations.
3. **Deadman heartbeats**: Enforces periodic heartbeat intervals (`POST /v1/devices/:id/heartbeat`) for continuous motion or dangerous actuators.
4. **Halt gate coordination**: Blocks execution while the daemon is in `HALTED` or `ESTOP_REQUESTED` state (while allowing non-actuating `dryRun` requests).

Direct `@pinout/core` SDK and local single-device CLI invocations evaluate module JSON schemas and legacy policies, but bypass the daemon's cross-process lease manager and multi-agent coordination (see [Intentional low-level SDK access](architecture.md#intentional-low-level-sdk-access)).
