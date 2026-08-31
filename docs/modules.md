# Pinout modules

A **module** describes support for a device class. A **device instance** is a concrete connected or simulated device registered with the runtime.

## Module vs device instance

| Concept | Describes |
| --- | --- |
| **Module** | Metadata, capability catalog, policies, supported transports, backend factory |
| **Device instance** | Stable id, live backend, health, operational state, session to hardware or simulator |

```text
Module (pinout/esp32)
  ├── device class: microcontroller
  ├── capabilities: gpio.*, sys.*
  ├── policies: ESP32 pin rules (via existing Device validation)
  └── factory: protocol transport → Session → Device

Device instance (esp32-01)
  ├── id: esp32-01
  ├── module: pinout/esp32
  ├── backend: protocol or simulated
  └── state: firmware identity + GPIO levels
```

## Built-in modules (Sprint 2)

| Module id | Device class | Backend |
| --- | --- | --- |
| `pinout/esp32` | `microcontroller` | Serial / simulated ESP32 (protocol v1) |
| `pinout/robot-arm` | `robot.manipulator` | In-process simulator |
| `pinout/environmental-chamber` | `lab.environmental_chamber` | In-process simulator |

## Registering devices

```ts
import { PinoutRuntime, robotArmModuleId } from '@pinout/core';

const runtime = new PinoutRuntime();
await runtime.registerFromModule(robotArmModuleId, {
  id: 'arm-sim-01',
  simulated: true,
});
await runtime.invoke('arm-sim-01', 'motion.home', {});
```

Or use `createHeterogeneousRuntime()` to register the default demo set (ESP32 + arm + chamber).

## Semantic capability families

Capabilities use dotted names grouped by physical semantics:

- `gpio.*` — digital I/O (microcontrollers)
- `motion.*`, `gripper.*`, `pose.*` — manipulators
- `temperature.*`, `door.*`, `experiment.*` — environmental chambers
- `status.*`, `sys.*` — diagnostics shared across classes

Implementation-specific details stay in module backends. The runtime and policy layer only see capability names and schemas.

## Extending

1. Define capability descriptors + policies in a new module file.
2. Implement a `DeviceBackend` (protocol or simulated).
3. Register the module with `registerModule()`.
4. Register device instances on a `PinoutRuntime`.

MCP and CLI consume capabilities from the runtime — they do not need ESP32-specific code.
