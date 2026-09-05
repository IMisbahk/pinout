# Physical Evidence State Contract

Software cannot guarantee or infer physical state transitions solely from successful command dispatches or microcontroller acknowledgements. Pinout enforces an **explicit physical-evidence state contract** that separates commanded host intent, device protocol acknowledgements, and independently observed sensory verification.

---

## 1. Architectural Audit

An audit of the previous state representation identified where state was stored, how it flowed across daemon and MCP boundaries, and where physical success was previously inferred without independent verification.

### 1.1 State Storage Locations

- **`packages/core/src/runtime/types.ts:54`**: `DeviceBackend.getOperationalState?(): Record<string, unknown>` defined operational state as an untyped dictionary of plain values lacking provenance, source attribution, observation timestamps, or freshness qualifiers.
- **`packages/core/src/runtime/deviceInstance.ts:29,64,126-128`**: `DeviceInstance.getOperationalState` and `getOperationalStateSnapshot()` captured synchronous snapshots of raw backend values without temporal decay or distinction between commanded and observed values.
- **`packages/core/src/runtime/composite.ts:83-89`**: `CompositeDeviceBackend.getOperationalState()` merged driver dictionaries by name (`state[name] = driver.getOperationalState()`), compounding unverified state across sub-drivers.

### 1.2 State Flow to Daemon and MCP

- **`packages/daemon/src/httpServer.ts:415,418-424`**:
  - `GET /v1/devices/:id` returned `{ operationalState: device.getOperationalStateSnapshot() }`.
  - `GET /v1/devices/:id/state` returned `{ deviceId: device.id, state: device.getOperationalStateSnapshot(), health: device.getHealth() }`.
  - Neither route exposed evidence sources, observation timestamps, or staleness indicators.
- **`packages/mcp/src/createDaemonServer.ts:53-83,85-88`**:
  - `pinout__describe_device` surfaced raw `operationalState`.
  - `pinout__read_state` queried `/v1/devices/:id/state` directly, passing plain unverified state to AI agents.
- **`packages/core/src/runtime/agentTools.ts:22-50` & `toolExport.ts:39-67`**: Capability tools exported schemas and danger annotations without state prerequisite assertions or freshness constraints.

### 1.3 Where Physical Success Was Previously Inferred

- **`packages/core/src/modules/semanticModules.ts:254-257`**: `relay.set` set `this.state.on = payload.on === true`, and `relay.read` immediately returned that commanded value as true physical state without readback or contact sensor feedback.
- **`packages/core/src/modules/semanticModules.ts:260-264`**: `valve.set` stored `this.state.opening = payload.opening`, immediately returned by `valve.read` without flow meter or encoder feedback.
- **`packages/core/src/modules/semanticModules.ts:270-274`**: `pump.set` stored `this.state.speed = payload.speed`, returned directly by `pump.read` without tachometer or pressure confirmation.
- **`packages/core/src/modules/semanticModules.ts:276-284`**: `power.set` and `power.output` recorded voltage and output enables in local memory, returned by `power.read` without actual voltage/current shunt measurements.
- **`packages/core/src/drivers/esp32/bridge.ts:233-241`**: In the simulated bridge handler, `gpio.write` modified in-memory `state.pins.set(pin, value)`, which was read back directly by `gpio.read`.
- **`packages/core/src/runtime/protocolBackend.ts:160-165`**: `invoke()` treated the microcontroller's JSON response `{ ok: true, result: { pin: 2, value: true } }` as full operation completion, even though an ACK only indicates firmware instruction receipt.

---

## 2. The Evidence-Qualified State Contract

### 2.1 Type Definitions

The canonical contracts live in `packages/core/src/spec/evidence.ts` and are re-exported by `@pinout/core`:

```typescript
export type EvidenceSource =
  | 'commanded'
  | 'acknowledged'
  | 'gpio-readback'
  | 'sensor'
  | 'simulated'
  | 'none';

export type EvidenceProvenance = 'simulated' | 'hardware' | 'unknown';

export interface EvidenceValue<T = unknown> {
  value: T | null;
  at: string | null; // ISO-8601 timestamp
  source: EvidenceSource;
}

export interface EvidenceState<T = unknown> {
  commanded: EvidenceValue<T>;
  acknowledged: EvidenceValue<T>;
  observed: EvidenceValue<T>;
  freshnessMs: number | null;
  stale: boolean;
  provenance: EvidenceProvenance;
}

export interface StatePrerequisite {
  key: string;
  expectedValue?: unknown;
  maxAgeMs?: number;
}

export type DeviceStateEvidence = Record<string, EvidenceState<unknown>>;
```

### 2.2 Core Rules

1. **Explicit Command Intent**: A successful write request sets `commanded` (`source: 'commanded'`).
2. **Firmware Receipt**: A device response/ACK sets `acknowledged` (`source: 'acknowledged'`).
3. **Independent Physical Evidence**: ONLY an independent read, dedicated sensor, physical readback pin, or unsolicited telemetry event sets `observed` (`source: 'gpio-readback' | 'sensor' | 'simulated'`).
4. **No Physical Inference from Writes**: A successful write command MUST NEVER update `observed`. If no independent observation exists, `observed.value` remains `null`, `observed.at` remains `null`, and `observed.source` remains `'none'`.
5. **Preservation of Unknown and Stale State**: Unknown values are preserved as `null` and never coerced to `false`, `0`, or default strings. Stale values remain intact alongside `stale: true` and their true `freshnessMs`.
6. **Dynamic Freshness Decay**: `freshnessMs` and `stale` are computed dynamically upon retrieval against a configured `maxAgeMs` and the current timestamp.

---

## 3. What Each Field Proves and Does Not Prove

| Field | What it Proves | What it DOES NOT Prove |
| --- | --- | --- |
| **`commanded`** | The host software generated and validated a command with specific arguments at timestamp `at`. | It does NOT prove the command was transmitted over the wire, received by the microcontroller, or acted upon by hardware. |
| **`acknowledged`** | The microcontroller firmware received the packet, parsed the JSON payload, and initiated local execution. | It does NOT prove electrical current flowed, coils energized, contacts moved, motors rotated, or valves opened. |
| **`observed`** | An independent electrical or physical sensing mechanism sampled the state at timestamp `at`. | It does NOT guarantee the state has not changed since the sample timestamp `at` (subject to `freshnessMs`). |

---

## 4. Freshness, Staleness, and Decay

Physical state is transient. An observation taken 5 seconds ago may no longer represent physical reality if external forces, operator intervention, or power loss occurred.

- **`freshnessMs`**: The non-negative duration in milliseconds between the observation timestamp (`observed.at`) and the evaluation time (`Date.now()`). If unobserved, `freshnessMs` is `null`.
- **`maxAgeMs`**: The maximum acceptable age before an observation is considered stale. Configurable per state key or per device.
- **`stale`**: `true` when `freshnessMs > maxAgeMs`. Staleness never clears or silently refreshes the underlying observed value.

---

## 5. Prerequisite Enforcement

Capabilities can declare dependencies on physical preconditions that must be verified by fresh, independent observation before actuation is permitted.

### 5.1 Prerequisite Definition

```typescript
const laserCutCapability: CapabilityDescriptor = {
  name: 'laser.cut',
  description: 'Energize industrial laser cutter',
  inputSchema: { ... },
  outputSchema: { ... },
  safety: { physicalOutput: true, reversible: false },
};

// Registered on DeviceInstance or module definition:
const prerequisites = {
  'laser.cut': [
    { key: 'door', expectedValue: 'closed', maxAgeMs: 5000 },
    { key: 'chiller_flow', expectedValue: true, maxAgeMs: 2000 },
  ],
};
```

### 5.2 Structured Rejection Errors

When `DeviceInstance.invoke()` is called, prerequisites are verified before policy evaluation or backend dispatch:

1. **`PREREQUISITE_MISSING`**: Thrown if the prerequisite key has no evidence record, `observed.value` is `null`, `observed.source === 'none'`, or `observed.value !== expectedValue`.
   ```json
   {
     "code": "PREREQUISITE_MISSING",
     "category": "SAFETY",
     "message": "Prerequisite 'door' is missing or has no observed physical evidence for capability 'laser.cut'.",
     "details": {
       "key": "door",
       "expectedValue": "closed",
       "observedValue": null,
       "observedSource": "none"
     }
   }
   ```

2. **`PREREQUISITE_STALE`**: Thrown if `observed.value` matches, but the observation timestamp is older than `maxAgeMs`.
   ```json
   {
     "code": "PREREQUISITE_STALE",
     "category": "SAFETY",
     "message": "Prerequisite 'door' observed value is stale (6200ms > maxAge 5000ms) for capability 'laser.cut'.",
     "details": {
       "key": "door",
       "maxAgeMs": 5000,
       "ageMs": 6200,
       "observedAt": "2026-09-05T17:10:00.000Z"
     }
   }
   ```

---

## 6. Module Adoption Guide

### 6.1 Worked Example: Lamp Module (`modules/lampModule.ts`)

The reference lamp module defines per-capability status fields:

```typescript
export interface LampStatus {
  commanded: { on: boolean | null; at: string | null };
  acknowledged: { on: boolean | null; at: string | null };
  observed: { on: boolean | null; at: string | null; source: LampObservedSource };
  freshnessMs: number | null;
  provenance: 'simulated' | 'hardware';
  armed: LampArmedState;
}
```

To integrate with the generic evidence contract:
1. `LampStatus.commanded` maps directly to `EvidenceValue<boolean>` with `source: 'commanded'`.
2. `LampStatus.acknowledged` maps directly to `EvidenceValue<boolean>` with `source: 'acknowledged'`.
3. `LampStatus.observed` maps to `EvidenceValue<boolean>` with `source: 'gpio-readback' | 'simulated' | 'none'`. When no readback pin is configured, `observed.value` remains `null` with `source: 'none'`.
4. `DeviceInstance.getStateEvidence()` automatically normalizes `LampStatus` into the unified `DeviceStateEvidence` map under key `status` or `on`.

### 6.2 Semantic Actuators (Relays, Valves, Pumps, Power Supplies)

For existing semantic modules:
1. `relay.set`: Records `commanded: { on }` and `acknowledged: { on }`. `observed` remains `null` unless a contact auxiliary input or power sensor is read.
2. `valve.set`: Records `commanded: { opening }` and `acknowledged: { opening }`. `observed` is set only when limit switches or optical flow sensors report.
3. `pump.set`: Records `commanded: { speed }` and `acknowledged: { speed }`. `observed` is updated only via tachometer or pressure telemetry.

---

## 7. Helper Utilities

The SDK provides functional helpers in `@pinout/core` to manipulate evidence states immutably:

```typescript
import {
  unknownEvidence,
  recordCommanded,
  recordAcknowledged,
  recordObserved,
  computeFreshness,
  isStale,
} from '@pinout/core';

let state = unknownEvidence('hardware');
state = recordCommanded(state, true);
state = recordAcknowledged(state, true);

// Later, upon sensor reading:
state = recordObserved(state, true, 'gpio-readback');

// Check freshness dynamically:
const current = computeFreshness(state, Date.now(), 5000);
if (isStale(state, 5000)) {
  // Take safe recovery action
}
```
