# Pinout

Pinout is the hardware intelligence layer for software and agents. It turns heterogeneous devices into a governed, inspectable control plane: capabilities have names, schemas, state, and safety annotations instead of asking every application to understand a vendor SDK or wiring diagram. Generated modules retain source evidence for review.

Pinout is an early, open-source platform—not a claim that a complete industrial fleet product or a catalog of shipped hardware already exists. This repository contains a working TypeScript SDK, CLI, MCP adapter, ESP32 serial bridge, multi-device runtime, simulators, external-module SDK, and documentation-to-module generator.

## Why Pinout

```text
Agent / application
        │ structured capability calls
        ▼
Pinout control plane
  discovery · schemas · policy · state
        │
        ├── ESP32 over serial (real hardware path)
        ├── module backends (extensible)
        └── protocol-faithful simulators (development path)
```

The unit of integration is a semantic capability—`distance.read`, `motion.move_to`, `temperature.set`, or `gpio.write`—not a board-specific command. The same descriptors produce SDK calls, CLI invocations, and MCP tools. Policies run before a backend, and modules own device-specific knowledge.

## Quick start

Node 20+ is required.

```bash
git clone https://github.com/imisbahk/pinout.git
cd pinout
npm install
npm test
npm run pinout -- hello --mock
npm run pinout -- gpio write 2 high --mock
npm run demo:robotics
```

No board is needed: `--mock` and the robotics demo run locally. The robotics workbench is a deterministic simulator; its readings and policy denials are useful for integration development, not evidence of physical performance.

Use the SDK directly:

```ts
import { connect, simulatedEsp32 } from '@pinout/core';

const board = await connect({ transport: simulatedEsp32() });
await board.gpio.write(2, true);
await board.close();
```

## Real hardware path

The first hardware target is a classic ESP32 DevKit (WROOM / 30-pin) running [`firmware/esp32-bridge`](firmware/esp32-bridge). Flash it, find the serial port, and run:

```bash
npm run pinout -- ports
npm run pinout -- hello --port /dev/cu.usbserial-10
npm run example:blink -- --port /dev/cu.usbserial-10
```

This path exercises the SDK, protocol framing, ready handshake, host-side validation, serial transport, and firmware. It does not make Pinout responsible for wiring, voltage, mechanics, emergency stops, or the behavior of an attached load. See [docs/production-architecture.md](docs/production-architecture.md) for the boundary between this reference path and a production deployment.

## A developer-facing hardware control plane

- **Agent-native discovery:** capability descriptors become typed SDK methods and MCP tools through `toAgentTools()` / `runtimeToAgentTools()`.
- **Semantic device model:** a multi-device runtime addresses motors, sensors, chambers, manipulators, and bases by stable instance ID.
- **Multi-driver composition:** one governed device can route capabilities across several named backends while preserving driver-attributed events and state.
- **Governed execution:** JSON Schema, numeric/state/workspace policies, timeouts, capability checks, and device validation happen before backend execution.
- **Bidirectional contracts:** backend results are checked against declared output schemas before they reach SDK, CLI, or agent callers.
- **Module ecosystem:** external modules use the public `defineModule()` API; the generator emits a candidate module that must be tested and reviewed before installation.
- **Simulation with an honest boundary:** simulators share protocol and runtime interfaces, while labels, configuration, and docs identify simulated devices.

## Repository map

| Area | What it contains |
| --- | --- |
| `packages/core` | Runtime, capabilities, policy engine, transports, protocol, ESP32 driver, simulators |
| `packages/cli` | `pinout` commands over the SDK |
| `packages/mcp` | MCP stdio adapter; no separate hardware logic |
| `packages/generator` | Vendor docs/SDK → candidate module pipeline |
| `firmware/esp32-bridge` | Minimal protocol v1 ESP32 firmware |
| `examples` | SDK, MCP, heterogeneous, and robotics narratives |
| `docs` | Product, architecture, modules, safety, generator, and operations guidance |

## Useful commands

```bash
npm run build
npm run lint
npm run typecheck
npm run format:check
npm run demo:heterogeneous
npm run demo:robotics
npm run demo:composite
npm run demo:generate
npm run example:mcp-heterogeneous
PINOUT_MOCK=1 npm run mcp
```

## Read next

- [Company and product](docs/company.md)
- [Product model](docs/product.md)
- [Architecture](docs/architecture.md)
- [Production architecture](docs/production-architecture.md)
- [Safety and policies](docs/policies.md)
- [Modules](docs/modules.md) and [build a module](docs/build-a-module.md)
- [Generator](docs/generator.md) and [generator safety](docs/generator-safety.md)
- [Demo narrative](docs/demo.md)
- [Roadmap](ROADMAP.md)
- [Security](SECURITY.md)
- [Contributing](CONTRIBUTING.md)

## Status

Experimental and changing. Protocol, package layout, and APIs may evolve. The repository prioritizes a working, reviewable foundation over unverified claims about customers, benchmarks, certifications, production fleets, or shipped Pinout hardware.
