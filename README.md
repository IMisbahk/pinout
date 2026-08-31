<div align="center">

# pinout

### Building intelligence for the physical world.

**A universal runtime for software, AI agents, and physical hardware.**

[Documentation](./docs/architecture.md) · [Build a Module](./docs/build-a-module.md) · [Contributing](./CONTRIBUTING.md) · [Research](#research)

<br />

![Tests](https://img.shields.io/badge/tests-127%20passing-brightgreen)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-blue)
![Hardware](https://img.shields.io/badge/hardware-ESP32%20%2B%20simulators-black)
![MCP](https://img.shields.io/badge/MCP-compatible-purple)
![License](https://img.shields.io/badge/license-Apache--2.0-blue)

</div>

---

AI can reason about software.

Physical machines are still fragmented behind vendor SDKs, serial protocols, GPIO libraries, industrial buses, proprietary APIs, and hundreds of incompatible control surfaces.

**Pinout is building the layer between intelligence and machines.**

```text
                         AI / Software
                              │
                              ▼
                    ┌─────────────────┐
                    │     Pinout      │
                    │                 │
                    │  capabilities   │
                    │  state          │
                    │  safety         │
                    │  policies       │
                    │  events         │
                    │  execution      │
                    └────────┬────────┘
                             │
             ┌───────────────┼───────────────┐
             │               │               │
             ▼               ▼               ▼
          ESP32          Robot Arm       Lab Hardware
           │                 │               │
         Serial            SDK / ROS       TCP / SDK
           │                 │               │
             └───────────────┼───────────────┘
                             │
                             ▼
                     Physical World
```

Pinout gives hardware a common, machine-readable interface based around **capabilities**.

Instead of teaching an agent about GPIO registers, vendor APIs, packet formats, or SDK quirks, hardware exposes actions such as:

```text
gpio.write
motion.move_to
gripper.close
temperature.set
experiment.start
```

The underlying implementation can be completely different.

The interface stays predictable.

---

## Why Pinout exists

Modern AI systems already have increasingly standardized ways to interact with software.

The physical world does not.

A robot arm, environmental chamber, microcontroller, microscope, CNC machine, sensor array, and PLC may all expose completely different programming models.

Pinout sits above that fragmentation.

```text
Vendor SDK      ─┐
Serial           │
TCP              │
Modbus           ├────► Pinout Module ────► Pinout Runtime
ROS              │
GPIO             │
Proprietary API ─┘
```

Applications and agents interact with **Pinout capabilities**, not the underlying transport.

---

# What exists today

Pinout is early and experimental, but the architecture already supports heterogeneous hardware.

### Runtime

A single `PinoutRuntime` can operate multiple fundamentally different devices simultaneously.

```text
PinoutRuntime
    │
    ├── esp32-01
    │     └── gpio.*
    │
    ├── arm-sim-01
    │     ├── motion.*
    │     ├── gripper.*
    │     └── pose.*
    │
    └── chamber-sim-01
          ├── temperature.*
          ├── door.*
          └── experiment.*
```

### Hardware

- ESP32 over USB serial
- simulated ESP32
- simulated robot manipulator
- simulated environmental chamber
- external third-party modules

### Interfaces

- TypeScript SDK
- CLI
- MCP
- TCP
- Serial
- loopback
- simulation

---

# Capabilities

Devices expose typed capabilities with JSON Schema inputs and outputs.

Example:

```ts
{
  id: "temperature.set",

  inputSchema: {
    type: "object",
    properties: {
      temperature: {
        type: "number"
      }
    },
    required: ["temperature"]
  }
}
```

An agent does not need to know how the physical machine implements `temperature.set`.

It only needs to know:

```text
what the capability does
what arguments it accepts
what it returns
what constraints apply
```

---

# Safety is outside the model

Pinout does **not** trust an AI model to enforce physical safety.

Requests pass through deterministic validation and policy enforcement before reaching hardware.

```text
Agent
  │
  ▼
Capability Request
  │
  ▼
Schema Validation
  │
  ▼
State Preconditions
  │
  ▼
Policy Engine
  │
  ├──── DENIED
  │
  ▼
Device Backend
  │
  ▼
Hardware
```

Example:

```text
temperature.set(200)
```

can return:

```text
POLICY_CONSTRAINT_VIOLATION
```

before the device backend ever receives the command.

Policies currently support:

- numeric limits
- physical workspace boundaries
- device-state preconditions
- module safety defaults
- deployment-level restrictions
- hardware-specific constraints

Deployment policies may make limits **stricter**, but cannot silently widen module-level safety boundaries.

---

# Modules

Hardware support is implemented through **Pinout Modules**.

A module describes:

```text
device identity
device class
capabilities
policies
backend implementation
simulation
metadata
```

Example:

```ts
import {
  defineModule,
  action,
  sensorRead,
} from "@pinout/core";

export default defineModule({
  id: "acme/temperature-sensor",
  version: "0.1.0",

  device: {
    class: "sensor.temperature",
    vendor: "Acme",
    model: "T100",
  },

  capabilities: [
    sensorRead({
      id: "temperature.read",
      // ...
    }),
  ],

  createBackend(config) {
    return new AcmeBackend(config);
  },
});
```

Modules live outside Pinout Core.

That means supporting new hardware does **not** require modifying the runtime itself.

---

# Build your own hardware module

Create one:

```bash
pinout module create my-device
```

Test it:

```bash
pinout module test ./my-device
```

Install it:

```bash
pinout module install ./my-device
```

Register hardware:

```bash
pinout device add sensor-01 \
  --module my-device \
  --simulated
```

Inspect devices:

```bash
pinout devices
```

Invoke a capability:

```bash
pinout invoke sensor-01 temperature.read \
  --payload '{}'
```

Once registered, the same capabilities can automatically become available to MCP-compatible agents.

No MCP-specific code is required inside the hardware module.

See [`docs/build-a-module.md`](./docs/build-a-module.md).

---

# AI hardware module compiler

Pinout can also begin translating existing hardware documentation into Pinout modules.

```bash
pinout generate ./vendor-sdk
```

The generator processes source material into an intermediate representation:

```text
Hardware Documentation
        │
        ▼
Source Ingestion
        │
        ▼
Interface Extraction
        │
        ▼
Hardware IR
        │
        ├── capabilities
        ├── interfaces
        ├── state
        ├── safety
        ├── evidence
        └── uncertainties
        │
        ▼
Candidate Pinout Module
```

Generate a plan first:

```bash
pinout generate ./vendor-sdk --plan
```

Example:

```text
Device
  Acme HeatBox 400

Suggested class
  lab.environmental_chamber

Capabilities
  HIGH    temperature.read
  HIGH    temperature.set
  HIGH    door.open
  HIGH    door.close
  MEDIUM  experiment.start

Safety
  HIGH    temperature range: 10–80°C

Unknown
  ? experiment.start timing semantics
  ? connection timeout is undocumented
```

Then generate a candidate module:

```bash
pinout generate ./vendor-sdk \
  --output ./generated/acme-heatbox
```

Generated modules contain:

```text
acme-heatbox/
├── pinout.module.json
├── package.json
├── src/
│   ├── index.ts
│   ├── backend.ts
│   └── generated.ts
├── test/
├── evidence/
│   └── report.json
├── GENERATION_REPORT.md
└── README.md
```

Generated hardware integrations are always:

```text
GENERATED
UNVERIFIED
```

They are **never automatically installed or connected to physical hardware**.

---

# Evidence over hallucination

Physical hardware is not a place where guessing is acceptable.

Every generated inference can carry:

- source evidence
- confidence
- uncertainty
- implementation status

For example:

```json
{
  "capability": "temperature.set",
  "confidence": 0.98,
  "evidence": [
    "manual.md:124-131"
  ]
}
```

Documented safety boundaries may become hard policies.

Inferred ones do not.

If Pinout cannot establish something safely, it should say:

```text
UNKNOWN
```

instead of inventing an answer.

---

# MCP

Pinout exposes registered hardware capabilities dynamically through MCP.

```text
Claude / Agent
      │
      ▼
     MCP
      │
      ▼
Pinout Runtime
      │
      ├── esp32-01
      ├── arm-sim-01
      └── chamber-sim-01
```

Tools are generated from runtime capabilities.

Example:

```text
esp32_01__gpio_write
arm_sim_01__motion_home
chamber_sim_01__temperature_set
```

MCP remains an **adapter**.

It is not Pinout's internal hardware model.

---

# Quick start

Requires **Node.js 20+**.

```bash
git clone https://github.com/pinoutlabs/pinout.git
cd pinout

npm install
npm test
```

All development can run without physical hardware.

---

## Try the heterogeneous runtime

```bash
npm run demo:heterogeneous
```

This launches multiple device classes through one runtime.

```text
✓ ESP32
✓ Robot Arm
✓ Environmental Chamber
```

The demo includes both successful physical operations and deterministic policy rejections.

---

## ESP32

Connect an ESP32 over USB serial and flash:

```text
firmware/esp32-bridge
```

Then:

```bash
pinout hello --port /dev/cu.usbserial-XXX
```

Blink:

```bash
pinout blink \
  --port /dev/cu.usbserial-XXX \
  --count 5
```

GPIO:

```bash
pinout gpio write 2 true \
  --port /dev/cu.usbserial-XXX
```

---

## No hardware?

Use the simulator.

```bash
pinout hello --mock
```

```bash
pinout blink --mock --count 5
```

---

# Architecture

```text
┌─────────────────────────────────────────────────────────────┐
│                    AI / APPLICATIONS                        │
│                                                             │
│          Agents · CLI · SDK · Automation · Research         │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       ADAPTERS                              │
│                                                             │
│                      MCP · APIs                             │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PINOUT RUNTIME                           │
│                                                             │
│   Device Registry       Capability Model      Event Bus     │
│   State                 Policy Engine         Execution     │
│   Health                Validation            Logging       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                      MODULE SDK                             │
│                                                             │
│   Device Metadata · Capabilities · Policies · Backend       │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                       TRANSPORTS                            │
│                                                             │
│              Serial · TCP · SDK · Simulation               │
└─────────────────────────────┬───────────────────────────────┘
                              │
                              ▼
┌─────────────────────────────────────────────────────────────┐
│                    PHYSICAL HARDWARE                        │
│                                                             │
│   Microcontrollers · Robots · Sensors · Lab Equipment       │
│   Industrial Systems · Machines · Future Pinout Hardware    │
└─────────────────────────────────────────────────────────────┘
```

More detail: [`docs/architecture.md`](./docs/architecture.md)

---

# Repository

```text
pinout/
├── packages/
│   ├── core/
│   ├── cli/
│   ├── mcp/
│   └── generator/
│
├── firmware/
│   └── esp32-bridge/
│
├── examples/
│   └── external-module/
│
├── fixtures/
├── docs/
└── tests/
```

---

# Design principles

### Hardware is stateful

Physical machines are not stateless REST endpoints.

Pinout models:

```text
actions
sensors
events
state
health
policies
```

as first-class concepts.

### Models reason. Controllers execute.

Pinout does not put an LLM inside a real-time motor-control loop.

Models should make higher-level decisions such as:

```text
motion.move_to(...)
```

while deterministic controllers handle timing-critical execution.

### Safety does not depend on prompting

Safety constraints live below the intelligence layer.

### Simulation and reality share an interface

A simulated backend and a physical backend implement the same Pinout device contract.

### Protocols are implementation details

Serial, TCP, ROS, CAN, SDKs, and future transports should not leak into the semantic capability layer.

### Unknown is better than wrong

Especially when software can move something.

---

# Current status

Pinout is **experimental research software**.

Current milestones:

```text
[✓] Hardware capability abstraction
[✓] ESP32 physical bridge
[✓] Transport-independent protocol
[✓] Heterogeneous device runtime
[✓] Stateful physical devices
[✓] Deterministic safety policies
[✓] Dynamic MCP exposure
[✓] External Module SDK
[✓] Module conformance testing
[✓] Persistent local device configuration
[✓] AI hardware-module generator
[ ] Large-scale real hardware validation
[ ] Hardware module registry
[ ] Verified module ecosystem
[ ] Robotics research platform
[ ] Pinout hardware
```

---

# Where this is going

Pinout begins as software infrastructure.

The longer-term research direction is much larger:

```text
Hardware Interfaces
        ↓
Physical Runtime
        ↓
Agent ↔ Machine Infrastructure
        ↓
Simulation + Safety
        ↓
Physical Intelligence
        ↓
Robotics Research
        ↓
Intelligent Machines
```

The goal is not merely to make hardware easier to program.

**The goal is to build the systems required for intelligence to operate in the physical world.**

---

# Research

Areas we are interested in include:

- agent-controlled physical systems
- machine-readable hardware capabilities
- physical-world safety and permission models
- hardware interface generation
- simulation and sim-to-real validation
- embodied intelligence
- world models
- autonomous manipulation
- robot learning
- cross-embodiment systems

Research notes and experiments will live alongside the software as Pinout develops.

---

# Contributing

Pinout needs weird hardware.

Especially hardware with:

- terrible SDKs
- strange serial protocols
- old vendor libraries
- incomplete documentation
- proprietary control surfaces
- unusual physical constraints

If you have something painful to integrate, we want to hear about it.

See [`CONTRIBUTING.md`](./CONTRIBUTING.md).

---

<div align="center">

### Give us your worst hardware.

We are trying to make the physical world programmable by intelligence.

<br />

**pinout**

*Building intelligence for the physical world.*

</div>
