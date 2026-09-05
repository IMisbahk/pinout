# Lamp Module (`pinout/lamp`)

The **Lamp** module (`pinout/lamp`, device class `actuator.lamp`) provides commissioned, semantic control and status observation for illumination and indicator hardware (such as reference LEDs, signal lamps, or solid-state relays) over the verified ESP32 path or in-process simulation.

## Product Promise: Semantic Abstraction

An AI agent or autonomous operator interacting through the Model Context Protocol (MCP) or Pinout SDK sees **only semantic tool interfaces**:
- `lamp.arm`
- `lamp.disarm`
- `lamp.on`
- `lamp.off`
- `lamp.set`
- `lamp.status` (and generic `status.read`)

The agent **never sees or manipulates GPIO pin numbers, electrical logic levels, or bus wiring**. All physical electrical details are declared in deployment configuration (`devices.json`) and verified by host safety rules before actuation is permitted.

---

## Explicit Arming & Host-Loss Watchdog

Pinout operates on a strict **fail-closed, explicit-arming model**:

1. **Disarmed at Boot & Reconnect**: Upon initialization, boot, transport reconnection, or reset, the device starts in the `disarmed` state. No physical actuation occurs implicitly.
2. **First Action is Explicit Arming (`lamp.arm`)**: An agent or operator must explicitly call `lamp.arm` (optionally configuring `timeoutMs`) before issuing any actuation commands (`lamp.on`, `lamp.off`, `lamp.set`). Calling actuation commands while `disarmed` is immediately rejected with error code `NOT_ARMED`.
3. **Continuous Deadman Heartbeat**: When armed, a deadman watchdog counts down. If host communication ceases, the device locally trips to its declared safe level and enters the `tripped` state.
4. **No Automatic Resumption After Trip**: Following a watchdog trip or link fault, commands are rejected with `WATCHDOG_TRIPPED`. The **only** way back to `armed` is an explicit `lamp.arm` call.
5. **Explicit Disarm (`lamp.disarm`)**: When finished or in safe shutdown, `lamp.disarm` stops the watchdog timer and immediately applies the commissioned fail-safe electrical level.
6. **`autoArm` Configuration Flag**: `autoArm` defaults to `false`. If explicitly set to `true` in deployment configuration, it is treated strictly as an opt-in for automated tests or legacy demos and logs a runtime safety warning.

---

## Capabilities & MCP Tools

| Capability | Tool Name (MCP) | Input | Output | Safety & Semantics |
| :--- | :--- | :--- | :--- | :--- |
| `lamp.arm` | `<id>__lamp_arm` | `{ timeoutMs? }` | `{ armed: "armed", timeoutMs? }` | Actuation gate. Arms the lamp and configures/kicks the host-loss watchdog. |
| `lamp.disarm` | `<id>__lamp_disarm` | `{}` | `{ armed: "disarmed" }` | Actuation gate. Disarms the lamp and enforces the commissioned safe level. |
| `lamp.on` | `<id>__lamp_on` | `{ validityMs? }` | `{ on: true }` | Physical actuation. Energizes the lamp output. Requires `armed` state. |
| `lamp.off` | `<id>__lamp_off` | `{ validityMs? }` | `{ on: false }` | Physical actuation. De-energizes the lamp output. Requires `armed` state. |
| `lamp.set` | `<id>__lamp_set` | `{ on: boolean, validityMs? }` | `{ on: boolean }` | Physical actuation. Sets lamp output state. Requires `armed` state. |
| `lamp.status` | `<id>__lamp_status` | `{}` | `LampStatus` object | Read-only. Returns multi-stage evidence model, freshness, provenance, and armed state. |

---

## Multi-Stage Evidence Model

A fundamental safety principle in Pinout is: **"Do not infer physical success from a successful write."**

A successful write to an ESP32 GPIO pin only proves that the host command reached the microcontroller and was acknowledged. It does not prove that current flowed, that a bulb illuminated, or that wiring is intact.

To make this distinction explicit and machine-verifiable, `lamp.status` returns:

```json
{
  "commanded": {
    "on": true,
    "at": "2026-09-05T17:18:19.515Z"
  },
  "acknowledged": {
    "on": true,
    "at": "2026-09-05T17:18:19.516Z"
  },
  "observed": {
    "on": null,
    "at": null,
    "source": "none"
  },
  "freshnessMs": null,
  "provenance": "simulated",
  "armed": "armed"
}
```

### Evidence Levels

| Field | Meaning | What It Proves | What It Does NOT Prove |
| :--- | :--- | :--- | :--- |
| `commanded` | The target state requested by host software. | Host intent. | Does not prove the command reached the device. |
| `acknowledged` | The command was received and acknowledged by the firmware (`gpio.write` ACK). | Host-device link communication and firmware pin driver write. | Does **not** prove the physical lamp produced photons or that the circuit is intact. |
| `observed` | Independent physical observation (e.g. from a photodiode, current sensor, or optical readback pin on `readbackPin`). | Independent electrical or optical sensor feedback. | `observed.on` remains `null` with `source: 'none'` unless an independent readback sensor is configured. |
| `freshnessMs` | Elapsed milliseconds since the last `observed` sample. | Temporal validity of observation. | |
| `provenance` | `'simulated'` or `'hardware'`. | Explicit simulation origin vs real hardware. | Prevents agents from confusing simulated environments with physical hardware. |
| `armed` | `'armed'`, `'disarmed'`, `'tripped'`, or `'unknown'`. | Deadman watchdog and arming gate status. | |

---

## Deployment Configuration & Wiring

Wiring is specified in deployment configuration (`devices.json`), not in code.

```json
{
  "schemaVersion": 1,
  "devices": [
    {
      "id": "lamp-01",
      "module": "pinout/lamp",
      "label": "Inspection Station Illumination",
      "backend": {
        "type": "protocol",
        "transport": {
          "type": "serial",
          "path": "/dev/cu.usbserial-0001",
          "baud": 115200
        }
      },
      "config": {
        "pin": 2,
        "polarity": "active-high",
        "safeLevel": "low",
        "maxOnMs": 30000,
        "readbackPin": 13,
        "readbackPolarity": "active-high"
      }
    }
  ]
}
```

### Configuration Fields

| Field | Type | Required | Description |
| :--- | :--- | :--- | :--- |
| `pin` | integer | Yes | ESP32 GPIO pin connected to the lamp driver circuit. Must be a valid writable pin. |
| `polarity` | `'active-high' \| 'active-low'` | Yes | Electrical load polarity. `active-high`: driven HIGH to energize; `active-low`: driven LOW to energize (sink current). |
| `safeLevel` | `'low' \| 'high' \| 'high-z' \| 'hold'` | Optional | Fail-safe electrical state applied on watchdog expiry, disarm, or halt. Defaults to the de-energized level matching `polarity`. |
| `readbackPin` | integer | Optional | GPIO pin connected to an independent physical feedback sensor (e.g., photo-transistor or current monitor). |
| `readbackPolarity` | `'active-high' \| 'active-low'` | Optional | Polarity for the readback sensor. Defaults to `'active-high'`. |
| `maxOnMs` | number | Optional | Maximum continuous on-time in milliseconds. If exceeded, the lamp automatically turns off. |
| `requireWatchdog`| boolean | Optional | Enforces that firmware must support host-loss deadman watchdog. Defaults to `true`. |
| `watchdogTimeoutMs` | number | Optional | Negotiated watchdog timeout interval. |
| `autoArm` | boolean | Optional | Whether to automatically arm upon initialization (defaults to `false`; demo/test opt-in only). |

### Polarity & Fail-Safe Inversion Rules

Safe-state configuration must guarantee de-energization during faults:
1. **Active-High Load (`polarity: "active-high"`)**:
   - De-energized electrical level is `LOW` (0 V).
   - Safe level must be `'low'` (or `'high-z'`).
   - A configuration with `safeLevel: "high"` is **REJECTED** with `UNSUPPORTED_CONFIGURATION` because safe state would dangerously energize the lamp.
2. **Active-Low Load (`polarity: "active-low"`)**:
   - De-energized electrical level is `HIGH` (3.3 V).
   - Safe level must be `'high'` (or `'high-z'`).
   - A configuration with `safeLevel: "low"` is **REJECTED** with `UNSUPPORTED_CONFIGURATION` because safe state would dangerously energize the lamp.

### Commissioning Guarantee

Before any actuation write occurs, the lamp backend commissions the pin safe state directly onto the device firmware via `gpio.configSafeState`. If host communication is severed or the host process crashes, the firmware locally enforces the configured safe level within the watchdog deadline without host intervention.

---

## Limits & Fault Behaviors

1. **Explicit Arming Gate**:
   - Actuation (`lamp.on`, `lamp.set { on: true }`) while `disarmed` is rejected with `NOT_ARMED`.
2. **Watchdog Expiry & Re-Arming**:
   - If the host watchdog expires, the device firmware applies safe state and enters `tripped` state.
   - Actuation is rejected with `WATCHDOG_TRIPPED`.
   - `commanded` and `acknowledged` values are **not** falsely overwritten with a claimed "off"; they retain their audit history.
   - Re-arming (`lamp.arm`) is required to resume physical actuation.
3. **Continuous On-Time Limits (`maxOnMs`)**:
   - If `maxOnMs` is configured, an automatic timer de-energizes the lamp if it remains on beyond the configured duration, protecting thermal and optical ratings.

---

## Verification Status

| Tier | Status | Details |
| :--- | :--- | :--- |
| **Protocol / SDK Contracts** | **VERIFIED** | Verified against the `@pinout/core` protocol test suites and simulated ESP32 bridge. |
| **Module Conformance** | **VERIFIED** | Passes `runModuleConformance` suite. |
| **Physical Hardware Bench Tests** | **PENDING** | Physical hardware acceptance tests on reference classic fixture (`hardware/reference/esp32-classic-led-sensor.md`) are pending dated bench records under `hardware/records/`. |
