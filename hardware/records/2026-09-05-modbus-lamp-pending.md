# Modbus Lamp Backend HIL Record — Pending

## Status: NOT RUN / PENDING

**Date Recorded:** 2026-09-05  
**Evidence Level:** `SIMULATED` / `IMPLEMENTED` (Software only; physical industrial hardware execution pending)

Physical hardware verification requires an operator with a physical Modbus TCP/RTU Remote I/O module (or PLC), a wired 24V indicator lamp/relay, an independent optical/current feedback sensor wired to a discrete input channel, and appropriate measurement instruments. No physical Modbus coil actuation, relay contact closure, lamp illumination, or hardware sensor observation is claimed by this record.

---

## What Was Prepared

1. **Protocol Implementation & Conformance:**
   - Location: `packages/protocols-modbus/src/lampBackend.ts`
   - Target Module: Modbus TCP / RTU Remote I/O unit (e.g., Advantech ADAM-6050, Moxa ioLogik E1212, or PLC slave).
   - Primary Output (Coil): Modbus Coil address 0 for lamp actuation (`lamp.on`, `lamp.off`, `lamp.set`).
   - Independent Feedback (Discrete Input): Modbus Discrete Input address 1 for physical observation (`lamp.status`).
   - Conformance: 100% pass on `@pinout/core` shared conformance suite `runLampConformance` with explicit arming, safe-state enforcement, honest error reporting, and multi-stage evidence model.

2. **Demonstration & In-Process Simulator:**
   - Location: `examples/lamp-modbus.ts` and `packages/protocols-modbus/src/simulator.ts`
   - Complete execution lifecycle including boot disarm verification, explicit arming gate, coil write, discrete input observation, and simulated wiring fault demonstration.

---

## What Was NOT Run

- No physical Modbus TCP bus coupler or RS-485 Modbus RTU serial device was connected to the host.
- No 24V power supply or relay contact was physically energized.
- No physical current transducer or photo-detector was wired to a discrete input.
- Physical communication timeout and disconnect behaviors were not verified against physical bus hardware.

---

## Procedure for Generating Verified Hardware Evidence

When physical Modbus equipment is available:

1. Connect the Modbus Remote I/O module to the local network (TCP) or RS-485 serial port (RTU).
2. Wire the indicator lamp circuit to Digital Output 0 (Coil 0).
3. Wire an independent optical sensor or auxiliary contact to Digital Input 1 (Discrete Input 1).
4. Run `examples/lamp-modbus.ts` configured with the physical device IP address/port or serial device path.
5. Record physical oscilloscope traces and voltmeter readings comparing coil actuation timing against optical sensor transitions.
6. Create a new dated record `hardware/records/YYYY-MM-DD-modbus-lamp.md` with measured timestamps, instrument serial numbers, and signed operator notes.
