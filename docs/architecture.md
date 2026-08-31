# Architecture

Pinout is a hardware abstraction layer. Applications and agents call typed actions. Drivers and firmware know how a particular board actually works.

```text
Application / CLI / future MCP adapter
                │
                ▼
         Pinout Device API
         (invoke, gpio, capabilities)
                │
                ▼
              Session
         (id matching, timeouts)
                │
                ▼
            Protocol v1
           (NDJSON codec)
                │
                ▼
             Transport
        (serial | simulated)
                │
                ▼
        Device firmware / simulator
```

## Packages

This repository is an npm workspace. Only packages with real code exist:

| Package | Role |
| --- | --- |
| `@pinout/core` | Abstractions, protocol, ESP32 pin rules, simulated device, Node serial transport. |
| `@pinout/cli` | Command line that calls the SDK. No independent hardware logic. |

Firmware lives in `firmware/esp32-bridge`. It is not an npm package.

Empty packages were not added for drivers, MCP, cameras, or robotics stacks. Those can become packages when they contain an implementation.

## Core concepts

**Transport** — opens, writes bytes, yields bytes, closes. Serial and the ESP32 simulator both implement this. BLE, TCP, or USB could implement it later without changing `Device`.

**Session** — line-framing, request ids, timeouts, `ready` handshake. Sessions speak Pinout protocol v1. They do not know what GPIO 2 means.

**Device** — the object application code holds. It knows which actions the firmware advertised and validates inputs before sending them.

**Capability** — a named action with description, JSON Schema input/output, and a safety annotation. `gpio.write` is a capability, not a special core type. A motor or camera later is another capability on some device.

**Driver knowledge** — ESP32 flash pins, input-only pins, and UART0 pins live under `drivers/esp32`. Core GPIO types only require a non-negative integer pin and a boolean level. Firmware repeats the same checks so a buggy host cannot drive a forbidden pin.

## Connection flow

1. Open the transport.
2. Ignore non-JSON lines (boot ROM noise on ESP32).
3. Wait for `event: ready`.
4. Send `sys.hello` and use that identity as source of truth.
5. Application calls `device.gpio.write(2, true)` or `device.invoke('gpio.write', { pin: 2, value: true })`.

## Simulation

`simulatedEsp32()` is a `Transport`. Internally it runs the same action handler the tests use to describe firmware behavior. The SDK does not take a shortcut around protocol encoding.

```text
SDK  →  protocol  →  simulated transport  →  ESP32 bridge handler
```

CI never needs a board.

## Safety

Software cannot guarantee physical safety. Pinout's job is to fail closed on inputs it can check:

- connection state
- timeouts
- malformed responses
- capability presence
- pin/range validation for known devices

Responsibility split:

| Layer | Responsible for |
| --- | --- |
| Application / agent | Whether this action should happen at all. Load, heat, people, mechanism. |
| SDK | Typed inputs, capability checks, timeouts, refusing known-bad ESP32 pins. |
| Firmware | Executing only supported actions, validating pins again, not crashing on bad JSON. |
| Hardware / operator | Wiring, voltage, mechanics, emergency stop. |

GPIO writes are marked `physicalOutput: true` in the capability descriptor because they change electrical state.

## Agents and MCP

The SDK does not depend on MCP.

`device.toAgentTools()` returns MCP-shaped tool descriptors from the same capability list:

- `name`
- `description`
- `inputSchema`
- `outputSchema`
- `annotations` (safety)

A future MCP server should wrap `connect()` + `invoke()` and expose those descriptors as tools. It should not reimplement GPIO or serial.

## Intentionally deferred

- Additional transports (BLE, TCP, CAN)
- PWM, I2C, SPI, sensors, motors, cameras
- Multi-device topology
- Flashing firmware from the CLI
- An MCP server process
- A published npm release
- ESP32-S3 native USB and RGB LEDs
