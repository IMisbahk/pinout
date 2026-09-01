# Pinout

**Building intelligence for the physical world.**

AI has developed standard ways to understand and operate software. The physical world remains fragmented behind device-specific SDKs, protocols, buses, and controllers. Pinout is the interface between intelligence and physical machines: capabilities have names, schemas, units, state, and safety annotations — instead of asking every application to reverse-engineer a vendor SDK or a wiring diagram.

Pinout is an early, open-source platform. This repository contains a working TypeScript runtime and SDK, CLI, MCP adapter, `pinoutd` daemon, a Python SDK, ESP32 firmware and a MicroPython bridge, Modbus and SCPI protocol adapters, multi-device runtime with simulators, an external-module SDK, and a documentation-to-module generator. It is not a claim that a complete industrial fleet product or a catalog of shipped hardware already exists.

## Why Pinout

```text
Intelligence
     │  structured capability calls
     ▼
┌────────────────────────────────┐
│ Pinout                         │
│ capabilities · state · safety  │
│ events · operations · leases   │
│ discovery · execution          │
└──────────┬─────────────────────┘
           │
   ┌───────┼────────┬─────────────┐
   ▼       ▼        ▼             ▼
 Robots  Machines  Instruments  Sensors
   └───────┴────────┴─────────────┘
                 │
          Physical World
```

The unit of integration is a semantic capability — `distance.read`, `motion.move_to`, `temperature.set`, `gpio.write`, `modbus.temperature.read` — not a board-specific command. The same descriptors produce SDK calls, CLI invocations, daemon API requests, and MCP tools. Policies run before a backend, and modules own device-specific knowledge.

## What the platform does

- **Capability semantics (spec v1):** every capability declares its schema, units, danger level, duration class, idempotency, and permissions. See [docs/spec/](docs/spec/overview.md).
- **Long-running operations:** physical actions return operation handles with progress streams, deadlines, cooperative cancellation, and idempotency keys that prevent duplicate physical side effects on retry.
- **Resource leases:** concurrent agents share a machine deterministically — exclusive or shared-read, device- or capability-scoped, with TTLs so a crashed agent cannot hold hardware forever.
- **Safety engine:** rate, interlock, sequence, approval, lease, deadman, resource-budget, range, and state policies enforced in deterministic runtime code. Deployment policies can only tighten module baselines; conflicts require human review.
- **Halt / E-stop coordination:** `NORMAL → RESTRICTED → HALTED → ESTOP_REQUESTED → FAULTED` states with audited transitions. Software coordination only — never a substitute for hardware safeguards.
- **Device composition:** a robot cell addresses `robot-cell-01.arm.motion.move_to` across components from different vendors via the DeviceGraph.
- **Control journal:** append-only, redacted record of invocations, policy decisions, operations, faults, and safety transitions — inspectable and replayable.
- **Data plane:** a stream bus for high-rate frames with backpressure policies, kept off the control plane and away from MCP.
- **`pinoutd` daemon:** local execution service bound to loopback only; HTTP API + SSE events; remote access requires explicit opt-in *and* auth. Dry-run mode resolves and policy-checks invocations without physical side effects.
- **Python SDK:** sync (stdlib-only) and asyncio clients with typed errors — robotics and scientific ecosystems are Python-first.
- **Protocol adapters:** Modbus TCP/RTU with declarative register maps (writes require explicit configuration), SCPI instrument layer (power supplies, DMMs, function generators), zero external dependencies.
- **Transport layer:** serial, TCP, UDP, WebSocket (with reconnect), loopback — each with timeouts and structured error classification.
- **Agent interfaces:** MCP tools derived dynamically from runtime capabilities; a protocol-neutral `runtimeToToolDefinitions()` export for any AI vendor's function-call format.

## Quick start

Node 20+ is required.

```bash
git clone https://github.com/pinoutlabs/pinout.git
cd pinout
npm install
npm test
npm run pinout -- hello --mock
npm run pinout -- gpio write 2 high --mock
npm run demo:robotics
```

No board is needed: `--mock` and the robotics demo run locally. Simulators share the real device contracts, but their readings and policy denials are integration aids, not evidence of physical performance.

Use the SDK directly:

```ts
import { connect, simulatedEsp32 } from '@pinout/core';

const board = await connect({ transport: simulatedEsp32() });
await board.gpio.write(2, true);
await board.close();
```

Run the daemon:

```bash
node packages/daemon/dist/main.js --demo --journal ./session.pinout-journal
# then: GET http://127.0.0.1:8787/v1/devices
```

Use Python:

```python
from pinout import Pinout

p = Pinout()                     # talks to pinoutd
arm = p.device("arm-01")
op = arm.invoke("motion.home")
print(op.result())
```

## Real hardware path

The first hardware target is a classic ESP32 DevKit (WROOM / 30-pin) running [`firmware/esp32-bridge`](firmware/esp32-bridge). A board-agnostic [`firmware/micropython-bridge`](firmware/micropython-bridge) extends coverage to MicroPython/CircuitPython boards (experimental).

```bash
npm run pinout -- ports
npm run pinout -- hello --port /dev/cu.usbserial-10
npm run example:blink -- --port /dev/cu.usbserial-10
```

This path exercises the SDK, protocol framing, ready handshake, host-side validation, serial transport, and firmware. It does not make Pinout responsible for wiring, voltage, mechanics, emergency stops, or the behavior of an attached load.

## Hardware support catalog

| Target | Status |
| --- | --- |
| ESP32 (bridge firmware: GPIO, PWM, ADC, I2C, SPI, servo/motor) | `IMPLEMENTED` (hardware path exercised; verification is per-deployment) |
| MicroPython / CircuitPython boards (generic bridge) | `EXPERIMENTAL` — host-validated protocol only |
| Simulated devices (18+ first-party modules: arm, mobile base, chamber, motors, sensors, …) | `SIMULATED` |
| Modbus TCP/RTU | `IMPLEMENTED` (in-process tested; not verified against physical equipment) |
| SCPI instruments (PSU, DMM, function generator) | `IMPLEMENTED` (scripted-transport tests; not hardware-verified) |
| Universal Robots, OPC UA, MAVLink, ROS 2 | `PLANNED` |

Never blur these statuses: `SIMULATED` is not hardware-verified, and a mocked test proves nothing about hardware.

## Repository map

| Area | What it contains |
| --- | --- |
| `packages/core` | Runtime, spec types, operations, leases, safety engine, halt coordinator, DeviceGraph, journal, stream bus, transports, ESP32 driver, simulators |
| `packages/daemon` | `pinoutd` — local execution service, HTTP API, SSE |
| `packages/cli` | `pinout` commands over the SDK |
| `packages/mcp` | MCP stdio adapter; no separate hardware logic |
| `packages/generator` | Vendor docs/SDK → candidate module pipeline |
| `packages/protocols-modbus` | Modbus TCP/RTU adapter + register maps |
| `sdk/python` | Python SDK (sync + asyncio) |
| `firmware/esp32-bridge` | Protocol v1 ESP32 firmware |
| `firmware/micropython-bridge` | Generic MicroPython/CircuitPython bridge |
| `examples` | SDK, MCP, heterogeneous, and robotics narratives |
| `docs` | Spec v1, product, architecture, modules, safety, generator guidance |

## Safety model, in one paragraph

Policies, leases, and halt states are enforced by deterministic runtime logic below any model. Capabilities carry descriptive danger levels; enforcement is policy-based. A prompt — however persuasive — cannot override a range check, an interlock, or an estop. Software halt/estop coordinates runtime behavior; it is not a certified emergency-stop system, and machinery deployments always require independent hardware safeguards.

## Read next

- [Spec v1 overview](docs/spec/overview.md) — device, capability, operations, leases, safety, errors, journal contracts
- [pinoutd daemon](docs/daemon.md)
- [Company and product](docs/company.md) · [Architecture](docs/architecture.md) · [Production architecture](docs/production-architecture.md)
- [Safety and policies](docs/policies.md)
- [Modules](docs/modules.md) and [build a module](docs/build-a-module.md)
- [Generator](docs/generator.md) and [generator safety](docs/generator-safety.md)
- [Roadmap](ROADMAP.md) · [Security](SECURITY.md) · [Contributing](CONTRIBUTING.md)

## Status

Experimental and changing. Protocol, package layout, and APIs may evolve. The repository prioritizes a working, reviewable foundation over unverified claims about customers, benchmarks, certifications, production fleets, or shipped Pinout hardware.
