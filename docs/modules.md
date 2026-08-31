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

## Built-in modules (Sprint 2+)

| Module id | Device class | Backend |
| --- | --- | --- |
| `pinout/esp32` | `microcontroller` | Serial / simulated ESP32 (protocol v1) |
| `pinout/robot-arm` | `robot.manipulator` | In-process simulator |
| `pinout/environmental-chamber` | `lab.environmental_chamber` | In-process simulator |
| `pinout/dc-motor` | `actuator.dc_motor` | In-process simulator |
| `pinout/servo` | `actuator.servo` | In-process simulator |
| `pinout/stepper` | `actuator.stepper` | In-process simulator |
| `pinout/distance` | `sensor.distance` | In-process simulator |
| `pinout/imu` | `sensor.imu` | In-process simulator |
| `pinout/encoder` | `sensor.encoder` | In-process simulator |
| `pinout/limit-switch` | `sensor.limit_switch` | In-process simulator |
| `pinout/force` | `sensor.force` | In-process simulator |

## External modules (Sprint 3)

Third-party modules use the public SDK:

```ts
import { defineModule, action } from '@pinout/core';

export default defineModule({ /* ... */ });
```

Manifest: `pinout.module.json`. Install locally with `pinout module install ./path`. See [build-a-module.md](build-a-module.md).

Built-in and installed modules share the same registry interface (`listAvailableModules`, `ensureModuleLoaded`).

## Registering devices

### Programmatic

```ts
import { PinoutRuntime, robotArmModuleId } from '@pinout/core';

const runtime = new PinoutRuntime();
await runtime.registerFromModule(robotArmModuleId, {
  id: 'arm-sim-01',
  simulated: true,
});
await runtime.invoke('arm-sim-01', 'motion.home', {});
```

Or bootstrap from persistent config:

```ts
const runtime = await PinoutRuntime.fromConfig();
// loads ~/.pinout/devices.json + installed modules
```

Or use `createHeterogeneousRuntime()` for the in-memory demo set when no config file exists.

## Semantic capability families

Capabilities use dotted names grouped by physical semantics:

- `gpio.*` — digital I/O (microcontrollers)
- `motion.*`, `gripper.*`, `pose.*` — manipulators
- `motor.*` — DC motors
- `servo.*` — hobby servos
- `stepper.*` — stepper motors
- `distance.*` — rangefinders
- `imu.*` — inertial measurement units
- `encoder.*` — quadrature encoders
- `limit.*` — end-stops / limit switches
- `force.*` — load cells / force sensors
- `temperature.*`, `door.*`, `experiment.*` — environmental chambers
- `temperature.*`, `humidity.*` — sensors (external modules)
- `status.*`, `sys.*` — diagnostics shared across classes

Implementation-specific details stay in module backends. The runtime and policy layer only see capability names and schemas.

## Extending

1. Run `pinout module create <name>` or copy [examples/external-module/weird-sensor](../examples/external-module/weird-sensor).
2. Implement capabilities with `defineModule` / `action` helpers.
3. Add `pinout.module.json` and build to `dist/`.
4. `pinout module test .` then `pinout module install .`
5. `pinout device add <id> --module <moduleId>`
6. Devices appear in runtime, MCP, and `pinout invoke` automatically.

**Generated candidates (Sprint 4):** `pinout generate ./vendor-sdk --output ./generated/device` produces an unverified module using the same SDK surface. See [generator.md](generator.md).

Legacy in-process extension: `registerModule()` still works for tests.
