# ESP32 Classic Reference Circuit HIL Record — Pending

## Status: NOT RUN / PENDING

**Date Recorded:** 2026-09-05  
**Evidence Level:** `COMPILE_TESTED` / `SIMULATED` (Software only; physical HIL execution pending)

Physical hardware verification requires an operator with a physical ESP32 DevKit V1 board, breadboard reference circuit, and measurement instruments. No physical GPIO actuation, LED illumination, watch events, watchdog trip, host crash response, USB disconnect, or oscilloscope timing measurement is claimed by this record.

---

## What Was Prepared

1. **Reference Circuit Specification:**
   - Location: `hardware/reference/esp32-classic-led-sensor.md`
   - Target Board: ESP32-WROOM-32 DevKit V1 30-pin (ESP32-D0WD MCU, CP2102/CH340 bridge).
   - Primary Output (Active-High): GPIO 2 with $330\,\Omega$ series resistor to Red LED and GND. Declared safe level: `LOW` (0 V).
   - Secondary Output (Active-Low): 3.3 V rail through $330\,\Omega$ series resistor and Green LED to GPIO 4. Declared safe level: `HIGH` (3.3 V). (Retained as pending physical coverage).
   - Input Sensor: GPIO 13 with internal pull-up to momentary tactile pushbutton switch $S_1$ to GND.
   - Restricted & Forbidden Pin Mapping: Complete prohibition on driving SPI flash (GPIO 6–11), MTDI strap (GPIO 12), and input-only pins (GPIO 34–39).
   - Power & Current Budget: Host USB 5 V only; $< 70\text{ mA}$ peak draw.
   - Step-by-Step Commissioning Checklist with strict manual flashing requirement.

2. **HIL Procedure & Evidence Template:**
   - Location: `scripts/hil/esp32-classic.md`
   - Complete execution plan with separate recording columns for Firmware/Protocol Acknowledgments vs Physical Observations / Instrument Measurements.
   - Detailed test cases for handshake, output/readback, sensor event watch, invalid pin safety rejection, watchdog expiry timing, host ungraceful kill (`kill -9`), and USB unplug/reconnect recovery.
   - Prescribed timing measurement method using a digital storage oscilloscope or USB logic analyzer with $\le 1\text{ ms}$ precision.

---

## What Was NOT Run

- No physical microcontroller was flashed or connected to a USB port.
- No electrical current was passed through LEDs or tactile switches.
- No oscilloscope or logic analyzer probes were attached to physical GPIO pins.
- Configured-expiry-to-safe-state response timing was not measured on physical hardware.
- Active-low fixture safe state behavior on GPIO 4 remains **PENDING** physical execution.

---

## Procedure for Generating Verified Hardware Evidence

When physical hardware is available:

1. Assemble the circuit described in `hardware/reference/esp32-classic-led-sensor.md`.
2. Connect oscilloscope or logic analyzer probes to GPIO 2, GPIO 4, and GPIO 13.
3. Follow the test sequence in `scripts/hil/esp32-classic.md`.
4. Copy the evidence matrix template from `scripts/hil/esp32-classic.md` into a new dated record file:
   `hardware/records/YYYY-MM-DD-esp32-classic-reference-circuit.md`.
5. Fill in operator details, commit SHA, exact instrument model, measured oscilloscope trace data, and separate firmware ACKs from physical observations.
6. Once a physical record is completed, submit a pull request with the dated record.
