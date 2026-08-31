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

## I2C (ESP32 bridge)

Default pins: SDA 21, SCL 22, 100 kHz. Payloads are capped at 32 bytes by the 512-byte protocol line.

### `i2c.begin`

Optional `{ sda, scl, frequency }`. Result echoes the active bus config.

### `i2c.write`

Input: `{ address, data }` where `address` is 0–127 and `data` is 1–32 bytes. Hardware returns `BUS_ERROR` on NACK.

### `i2c.read`

Input: `{ address, length }`. Output: `{ address, data }`.

### `i2c.scan`

Returns `{ addresses }` for devices that acknowledge (1–127). The simulator returns addresses that have been written.

## SPI (ESP32 bridge)

Default pins: SCK 18, MISO 19, MOSI 23, CS 5, 1 MHz, mode 0.

### `spi.begin`

Optional `{ sck, miso, mosi, chipSelect, frequency }`.

### `spi.transfer`

Input: `{ data, chipSelect? }`. Full-duplex; the simulator echoes `data`.

## Robot manipulator (`pinout/robot-arm`)

Semantic motion and gripper capabilities for simulated and future real arms.

| Capability | Input | Notes |
| --- | --- | --- |
| `motion.home` | `{}` | Move to home pose |
| `motion.move_to` | `{ x, y, z }` | Workspace enforced by policy (±1 m, z 0–1.5 m) |
| `motion.stop` | `{}` | Stop in-progress motion |
| `gripper.open` / `gripper.close` | `{}` | Emits `gripper.changed` |
| `pose.read` | `{}` | Current pose + gripper |
| `status.read` | `{}` | Operational status snapshot |

Events: `motion.started`, `motion.completed`, `motion.stopped`, `gripper.changed`, `device.fault`.

## Environmental chamber (`pinout/environmental-chamber`)

| Capability | Input | Notes |
| --- | --- | --- |
| `temperature.read` | `{}` | Current and target °C |
| `temperature.set` | `{ value }` | Policy: 10–80 °C |
| `door.open` / `door.close` | `{}` | Emits `door.changed` |
| `experiment.start` | `{}` | Policy: door must be `closed` |
| `experiment.stop` | `{}` | Returns experiment to `idle` |
| `status.read` | `{}` | Full chamber state |

Events: `temperature.changed`, `door.changed`, `experiment.started`, `experiment.stopped`.

## DC motor (`pinout/dc-motor`)

| Capability | Input | Notes |
| --- | --- | --- |
| `motor.set` | `{ speed }` | Policy: speed −1 to 1 |
| `motor.stop` | `{}` | Sets speed to 0 |
| `motor.read` | `{}` | Commanded speed |
| `status.read` | `{}` | `ready` / `running` / `stopped` / `faulted` |

Events: `motor.changed`.

## Hobby servo (`pinout/servo`)

| Capability | Input | Notes |
| --- | --- | --- |
| `servo.set_angle` | `{ angle }` | Policy: 0–180° |
| `servo.read` | `{}` | Commanded angle |
| `status.read` | `{}` | Operational snapshot |

Events: `servo.changed`.

## Stepper motor (`pinout/stepper`)

| Capability | Input | Notes |
| --- | --- | --- |
| `stepper.step` | `{ steps }` | Relative steps; policy ±100000 |
| `stepper.goto` | `{ position }` | Absolute position; policy ±100000 |
| `stepper.home` | `{}` | Move to step 0 |
| `stepper.stop` | `{}` | Halt motion |
| `stepper.read` | `{}` | Position + homed |
| `status.read` | `{}` | Operational snapshot |

Events: `stepper.moved`, `stepper.stopped`.

## Agent tools

`device.toAgentTools()` maps each advertised capability to an MCP-shaped tool descriptor for **single-device** connections.

`PinoutRuntime` + `@pinout/mcp` derive tools dynamically from all registered devices (`esp32_01__gpio_write`, `arm_sim_01__motion_home`, etc.). See [modules.md](modules.md).

## Adding a capability

1. Add the descriptor in `packages/core/src/capabilities.ts`.
2. Implement the action in the ESP32 bridge handler and simulator.
3. Add validation in `device.invoke()` when host-side checks are needed.
4. Add CLI support and tests.
5. Update this file and [docs/protocol.md](protocol.md).

See [CONTRIBUTING.md](../CONTRIBUTING.md) for the full recipe.
