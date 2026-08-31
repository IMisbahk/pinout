# Capability catalog

Pinout devices expose **capabilities** — named actions with JSON Schema inputs/outputs and safety annotations. Hosts call them through `device.invoke()` or convenience facades like `device.gpio.write()`.

The catalog below matches `@pinout/core` descriptors and the ESP32 bridge firmware. Simulator and hardware implement the same action names.

## System

### `sys.hello`

Handshake with the device and return firmware identity plus supported actions.

| | |
| --- | --- |
| Input | `{}` |
| Output | `{ firmware, version, protocol, capabilities }` |
| Safety | Read-only |

Also emitted unsolicited as the `ready` event payload after the transport opens.

### `sys.ping`

Round-trip liveness check.

| | |
| --- | --- |
| Input | `{}` |
| Output | `{ pong: true }` |
| Safety | Read-only |

### `sys.info`

Runtime diagnostics (uptime; free heap on hardware, stubbed on simulator).

| | |
| --- | --- |
| Input | `{}` |
| Output | `{ uptimeMs, freeHeap? }` |
| Safety | Read-only |

## GPIO

### `gpio.mode`

Configure pin mode: `input`, `output`, `pullup`, or `pulldown`.

### `gpio.write`

Drive a GPIO pin high or low. Input: `{ pin, value }`. Output: `{ pin, value }`. Safety: physical output.

### `gpio.read`

Read pin level. Input: `{ pin }`. Output: `{ pin, value }`. Safety: read-only.

### `gpio.toggle`

Flip the driven level of an output pin.

### `gpio.pulse`

Drive high for `durationMs`, then return low.

### `gpio.pwm`

LEDC PWM: `{ channel, pin, duty, frequency }`. Set duty to `0` to stop.

### `gpio.analogRead`

ADC sample on GPIO 32–39. Output `value` is 0–4095.

### `gpio.watch` / `gpio.unwatch`

Subscribe or unsubscribe to `gpio.changed` events for a pin.

## Agent tools

`device.toAgentTools()` maps each advertised capability to an MCP-shaped tool descriptor. `@pinout/mcp` exposes those descriptors over stdio and routes `tools/call` through `device.invoke()`.

## Adding a capability

1. Add the descriptor in `packages/core/src/capabilities.ts`.
2. Implement the action in the ESP32 bridge handler and simulator.
3. Add validation in `device.invoke()` when host-side checks are needed.
4. Add CLI support and tests.
5. Update this file and [docs/protocol.md](protocol.md).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full recipe.
