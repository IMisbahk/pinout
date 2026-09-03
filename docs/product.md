# Product model

Pinout has a deliberately narrow product model:

```text
Module → device instance → capability → invocation → observed state
```

## Module

A module packages a device class, capability descriptors, policies, supported transports, and a backend factory. Built-ins cover the ESP32 bridge plus simulated robotics, sensing, and chamber classes. Third-party modules are loaded from the local registry under `~/.pinout/modules/`.

## Device instance

An instance is a configured identity such as `arm-sim-01` or `esp32-01`, with lifecycle, health, operational state, and a live or simulated backend. A runtime can hold heterogeneous instances and address them by ID.

## Capability

A capability is a dotted semantic action with input/output JSON Schema and safety metadata. Descriptors are the source for SDK invocation, CLI command surfaces, and MCP tool definitions. This prevents an agent integration from silently acquiring a second, less-governed command path.

## Policy boundary

Runtime policy evaluates schema, numeric bounds, state preconditions, and workspace constraints before the backend. It cannot infer wiring, load risk, human presence, or an emergency-stop circuit; those remain deployment responsibilities.

## Extension path

Authors can define modules with the public SDK, run conformance checks, install locally, and expose them through the same runtime. The generator converts vendor material into an explicitly unverified candidate. Human review and hardware validation are required before use.
