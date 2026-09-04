# Hardware support

The authoritative matrix is [`hardware/catalog.json`](../hardware/catalog.json). This page explains how to read it; it intentionally does not duplicate rows that can drift.

`SIMULATED`, `COMPILE_TESTED`, `IMPLEMENTED`, and `INTEGRATION_VERIFIED` describe software evidence. `HARDWARE_VERIFIED` is reserved for a dated hardware record under `hardware/records/` and does not imply certification or suitability for mains equipment.

For the alpha, the classic ESP32 DevKit firmware is the reference embedded target. ESP32-C3/S2/S3/C6, Raspberry Pi, BLE, and industrial protocol integrations remain experimental, planned, or software-only as recorded in the catalog. Discovery is read-only; enrollment and actuation are separate operations.
