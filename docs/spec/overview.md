# Pinout Spec v1 — Overview

Pinout is the interface between intelligence and physical machines. This
directory defines the semantic contracts shared by the runtime, transports,
protocol adapters, SDKs, simulators, and agent interfaces. The TypeScript
definitions live in `packages/core/src/spec/`; every serializable envelope
carries `specVersion` (`1.0`).

## Architectural law

These principles are non-negotiable:

1. **The model does not control real-time loops.** LLMs reason at the high
   level (`motion.move_to`); deterministic code executes control.
2. **Hardware is stateful.** Devices have state, health, time, faults,
   operations, and physical constraints — not just function calls.
3. **Safety is below the model.** A prompt cannot override physical safety;
   the policy engine and halt coordinator enforce constraints in runtime code.
4. **Unknown is better than hallucinated.** For voltages, currents, speeds,
   forces, ranges, units, and pins: never invent.
5. **Agent protocols are adapters.** MCP and any future AI protocol are
   adapters; Core has no semantic dependency on any of them.
6. **Modules contain device-specific knowledge.** No `if (vendor === ...)`
   inside generic runtime code.
7. **Simulation and reality share contracts.** A simulator implements the
   same device/capability contracts as the physical backend.
8. **Control plane and data plane are different.** Commands, state, and
   operations ride the control plane; camera frames and high-rate telemetry
   ride the stream bus (`src/stream`).
9. **Execution stays local by default.** `pinoutd` binds loopback; physical
   actuation never depends on cloud availability.

## Document map

| Page | Contents |
| --- | --- |
| [device.md](./device.md) | Identity, health, descriptors, composition (DeviceGraph) |
| [capabilities.md](./capabilities.md) | Capability kinds, danger levels, metadata |
| [operations.md](./operations.md) | Long-running operation lifecycle |
| [leases.md](./leases.md) | Resource leases and concurrency |
| [safety.md](./safety.md) | Policies, provenance, halt/estop semantics |
| [errors.md](./errors.md) | Stable error taxonomy |
| [journal.md](./journal.md) | Control journal and replay |

## Versioning

- `SPEC_VERSION` in `packages/core/src/spec/version.ts` is the single source.
- Additive changes bump the minor; breaking changes to serialized shapes bump
  the major and require compatibility shims.
- Consumers must reject envelopes whose major version they do not understand
  (`isCompatibleSpecVersion`).
