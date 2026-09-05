# Modbus Lamp Backend (`@pinout/protocols-modbus`)

The **Modbus Lamp Backend** provides commissioned, semantic control and physical evidence observation for lamps, beacons, and relay-driven indicators over Modbus TCP or Modbus RTU devices (e.g. industrial Remote I/O modules, PLCs, bus couplers).

## Status: SIMULATED (Software & Conformance Verified)

All contracts, protocol framing, and multi-stage evidence states are verified in-process using `SimulatedModbusServer` and `@pinout/core` shared conformance suites (`runLampConformance`). No physical industrial PLC or high-voltage relay has been actuated in this session.

---

## Semantic Mapping & Physical Evidence Model

The semantic `lamp` contract separates host intent (`commanded`), device communication receipt (`acknowledged`), and independent physical feedback (`observed`).

| Lamp Capability / Field | Modbus Operation | Evidence Level & Source | What It Proves | What It Does NOT Prove |
| :--- | :--- | :--- | :--- | :--- |
| `lamp.arm` | Host-side safety gate & state transition | `acknowledged` (`armed: 'armed'`) | Host has explicitly permitted physical actuation. | Does not guarantee downstream field wiring is energized. |
| `lamp.disarm` | Write safe coil level (FC 0x05) | `acknowledged` (`armed: 'disarmed'`) | Safe coil level written to slave device. | Does not verify mechanical contact separation without readback. |
| `lamp.on` / `lamp.set { on: true }` | Write Single Coil (FC 0x05) | `commanded` (`on: true`, `source: 'commanded'`) & `acknowledged` (`on: true`, `source: 'acknowledged'`) | Modbus frame reached slave and coil state was accepted. | **Does NOT prove current flowed or bulb illuminated.** |
| `lamp.off` / `lamp.set { on: false }` | Write Single Coil (FC 0x05) | `commanded` (`on: false`) & `acknowledged` (`on: false`) | Modbus de-energize frame confirmed by slave. | Does not guarantee contacts did not weld closed without sensor readback. |
| `lamp.status` (without readback) | Read Coils (FC 0x01) | `acknowledged` (`source: 'acknowledged'`), `observed: null` (`source: 'none'`) | Slave device internal register state. | No physical optical or electrical sensing exists. |
| `lamp.status` (with `discreteInput`) | Read Discrete Inputs (FC 0x02) | `observed` (`source: 'sensor'` / `'simulated'`) | Independent physical sensor (e.g., optical sensor, current shunt, or auxiliary contact) state. | Does not guarantee state has not changed since timestamp (`freshnessMs`). |

### Why Reading Back the Coil is NOT "Observed"

In Modbus:
- Reading back the **Coil** (FC 0x01) queries the device's internal output register. It only proves that the slave controller processed the write command. This is mapped strictly to **`acknowledged`**.
- Reading a separate **Discrete Input** (FC 0x02) connected to an independent auxiliary contact, current transducer, or optical sensor samples independent electrical/physical reality. Only this separate input is mapped to **`observed`** with `source: 'sensor'` (or `source: 'simulated'`).

---

## Watchdog & Host-Loss Safety Considerations

Standard Modbus protocol (Modbus TCP / RTU) is a master-poll protocol without built-in autonomous host-loss heartbeat detection in generic slave hardware.

1. **Explicit Watchdog Policy**:
   - `requireWatchdog` defaults to `true`.
   - Because standard Modbus slave hardware does not provide an autonomous deadman watchdog timer, attempting to arm with `requireWatchdog: true` will fail with error code `WATCHDOG_NOT_SUPPORTED`.
   - Operators and deployment configurations must explicitly set `requireWatchdog: false` to acknowledge that host-loss fail-safe relies on host-level heartbeat supervision or external hardware watchdogs.
2. **Explicit Arming Gate**:
   - Devices initialize in `disarmed` state at startup.
   - Actuation commands (`lamp.on`, `lamp.off`, `lamp.set`) issued while `disarmed` are rejected with `NOT_ARMED`.
3. **Fail-Safe Disarm (`lamp.disarm`)**:
   - Explicit disarm immediately writes the commissioned safe level to the Modbus coil.

---

## Configuration Reference

```typescript
import { createModbusLampBackend } from '@pinout/protocols-modbus';

const backend = await createModbusLampBackend({
  coil: 0,                           // Modbus 0-indexed coil address for actuation
  discreteInput: 1,                  // Optional 0-indexed discrete input address for readback
  unitId: 1,                         // Modbus Unit / Slave ID (default: 1)
  polarity: 'active-high',           // 'active-high' (1 = energized) or 'active-low' (0 = energized)
  safeLevel: 'low',                  // 'low' or 'high' fail-safe electrical level
  readbackPolarity: 'active-high',   // Sensor polarity
  requireWatchdog: false,            // Explicit acknowledgement of Modbus watchdog limitation
  maxOnMs: 30000,                    // Optional automatic on-time shutoff in milliseconds
  observationMaxAgeMs: 5000,         // Freshness threshold for sensor observations
  provenance: 'simulated',           // 'simulated' or 'hardware'
});
```

### Polarity & Fail-Safe Inversion Rules

- **Active-High Load (`polarity: 'active-high'`)**:
  - Energized: coil = `true` (1).
  - De-energized safe level: `low` (coil = `false` / 0).
  - Setting `safeLevel: 'high'` is rejected with `UNSUPPORTED_CONFIGURATION`.
- **Active-Low Load (`polarity: 'active-low'`)**:
  - Energized: coil = `false` (0).
  - De-energized safe level: `high` (coil = `true` / 1).
  - Setting `safeLevel: 'low'` is rejected with `UNSUPPORTED_CONFIGURATION`.

---

## Commissioning Physical Hardware (Never Auto-Configured)

When deploying to physical hardware:
1. Verify the slave device manual for exact coil and discrete input register numbering (note 0-based vs 1-based address offsets).
2. Wire the primary lamp or relay driver to the designated digital output channel.
3. Wire an independent feedback transducer (auxiliary contact, current switch, or phototransistor) to a designated discrete input channel.
4. Declare addresses and electrical polarity in `devices.json`.
5. Run the commissioning verification checklist before energizing physical high-voltage loads.
