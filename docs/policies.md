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
