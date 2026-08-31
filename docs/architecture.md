# Architecture

Pinout is a hardware abstraction layer. Applications and agents call typed actions. Drivers and firmware know how a particular board actually works.

```text
Application / CLI / MCP adapter
                │
                ▼
         PinoutRuntime (multi-device)
                │
       ┌────────┼────────┐
       ▼        ▼        ▼
   Device    Device    Device
  instance  instance  instance
       │        │        │
       ▼        ▼        ▼
  policy + schema validation
       │        │        │
       ▼        ▼        ▼
   backend  backend  backend
 (protocol) (sim arm) (sim chamber)
```

Single-device code paths still use `connect()` → `Device` → `Session` directly. The runtime wraps multiple devices behind one API.

**PinoutRuntime** — multi-device registry. Loads modules from built-ins + `~/.pinout/modules/`. Bootstraps devices from `devices.json` via `PinoutRuntime.fromConfig()`.

**Module SDK** — `defineModule()` validates and exports a `PinoutModuleDefinition`. External packages never import internal paths.

**Local registry** — `~/.pinout/` stores installed modules and device config. Not a cloud service.

See [docs/modules.md](modules.md), [docs/policies.md](policies.md), [docs/build-a-module.md](build-a-module.md), [docs/generator.md](generator.md).

## Packages

This repository is an npm workspace:

| Package | Role |
| --- | --- |
| `@pinout/core` | Abstractions, protocol, ESP32 pin rules, simulated device, Node serial transport. |
| `@pinout/cli` | Command line that calls the SDK. No independent hardware logic. |
| `@pinout/mcp` | Thin MCP stdio server: single-device or runtime-derived tools from all registered devices. |
| `@pinout/generator` | Documentation/SDK → Hardware IR → candidate external module (no AI deps in core). |

Firmware lives in `firmware/esp32-bridge`. It is not an npm package.

## Generate pipeline (Sprint 4)

```text
Hardware docs / SDK
        │
        ▼
   @pinout/generator
   (ingest → IR → emit)
        │
        ▼
  Candidate module (GENERATED / UNVERIFIED)
        │
        ▼
  pinout module test → human review → install
```

See [docs/generator.md](generator.md) and [docs/generator-safety.md](generator-safety.md).

## Core concepts

**Transport** — opens, writes bytes, yields bytes, closes. Serial and the ESP32 simulator both implement this. Additional transports can implement the same interface without changing `Device`.

**Session** — line-framing, request ids, timeouts, `ready` handshake. Sessions speak Pinout protocol v1. They do not know what GPIO 2 means.

**Device** — the object application code holds. It knows which actions the firmware advertised and validates inputs before sending them.

**Capability** — a named action with description, JSON Schema input/output, and a safety annotation. `gpio.write` is a capability, not a special core type. A motor or camera later is another capability on some device.

**Driver knowledge** — ESP32 flash pins, input-only pins, UART0, GPIO 12 strap, and ADC pins live under `drivers/esp32`. Firmware repeats the same checks.

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

`@pinout/mcp` wraps `connect()` + `invoke()` and exposes those descriptors over stdio. It does not reimplement GPIO or serial, and it does not expose raw shell commands.

## Events

Firmware and the simulator may emit `{ v, event, payload }` lines. `ready` is the handshake. Other events (`gpio.changed`) are dispatched to `device.on()` / `once()` / `off()`.

## Intentionally deferred

- BLE and CAN transports
- Cameras
- Flashing firmware from the CLI
- A published npm release
- ESP32-S3 native USB and RGB LEDs

See [docs/capabilities.md](capabilities.md) for the current action catalog.
