# Hardware support

The authoritative matrix is [`hardware/catalog.json`](../hardware/catalog.json). This page explains how to read it; it intentionally does not duplicate rows that can drift.

## Evidence Levels

- `SIMULATED`, `COMPILE_TESTED`, `IMPLEMENTED`, and `INTEGRATION_VERIFIED` describe software evidence.
- `HARDWARE_VERIFIED` is strictly reserved for an operator-observed, dated hardware record under `hardware/records/` and does not imply certification or suitability for mains equipment.

## Alpha Reference Target: ESP32 Classic

For the alpha release, the classic ESP32 DevKit (`esp32-devkit-v1` / ESP-WROOM-32 30-pin) firmware is the reference embedded target:

- **Catalog Status:** `COMPILE_TESTED` (firmware builds cleanly under PlatformIO; GPIO/PWM/ADC/I2C/SPI logic tested against simulator; serial transport verified).
- **Physical Verification:** **PENDING** — physical hardware-in-the-loop (HIL) execution has not yet been conducted.
- **Reference Circuit:** See [`hardware/reference/esp32-classic-led-sensor.md`](../hardware/reference/esp32-classic-led-sensor.md) for the documented low-voltage LED and sensor test fixture (including active-high, active-low, and button wiring).
- **HIL Test Procedure:** See [`scripts/hil/esp32-classic.md`](../scripts/hil/esp32-classic.md) for the step-by-step physical test matrix, including separate recording of protocol acknowledgments and physical oscilloscope measurements.
- **Test Records:** Tracked in [`hardware/records/2026-09-04-esp32-classic-pending.md`](../hardware/records/2026-09-04-esp32-classic-pending.md) and [`hardware/records/2026-09-05-esp32-classic-reference-circuit-pending.md`](../hardware/records/2026-09-05-esp32-classic-reference-circuit-pending.md).

ESP32-C3/S2/S3/C6, Raspberry Pi, BLE, and industrial protocol integrations remain experimental, planned, or software-only as recorded in the catalog.

## Flashing Policy: Never Auto-Flash Unidentified Hardware

Pinout enforces a strict safety boundary around device flashing:

1. **No Auto-Flashing:** Pinout does not automatically flash firmware or upload code to attached serial devices. Discovery (`pinout discover`) and port listing (`pinout ports`) are strictly passive and read-only; enrollment (`pinout enroll`) handshakes only with already-running Pinout firmware.
2. **Hard Requirement for Flashing Tooling:** Any future flashing utility or command must refuse to proceed unless:
   - The target board is positively identified (USB VID/PID matching a known descriptor in `firmware/boards/`, or an explicit `--board <board-id>` flag).
   - The operator explicitly confirms the flash operation (interactive prompt or `--yes` flag).
3. **Manual Flash Workflow:** Firmware upload is performed explicitly by the operator using PlatformIO (`pio run -e esp32dev -t upload`) or Arduino IDE after verifying the physical board identity and wiring.
