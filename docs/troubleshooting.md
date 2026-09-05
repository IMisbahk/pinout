# Troubleshooting

- **Daemon Reachability:** Confirm the daemon is reachable on its configured loopback URL and inspect `pinout daemon status`.
- **Serial Reset on Connect:** A serial connect can reset classic ESP32 boards through DTR/RTS lines. Reconnect with `resetOnConnect: false` or wait for the device boot lifecycle to settle before sending commands.
- **Unidentified Serial Ports & Flashing:** Pinout tools never automatically flash firmware to connected serial devices. If a port does not respond to `pinout hello` or enrollment fails, visually inspect the board, check the USB VID/PID against `firmware/boards/`, and manually flash using PlatformIO (`cd firmware/esp32-bridge && pio run -e esp32dev -t upload`).
- **Firmware Identity & Protocol Mismatches:** If `pinout hello` returns an unexpected firmware name or protocol version, verify that the board is running `firmware/esp32-bridge` (reporting `firmware: "esp32-bridge"`, `protocol: 1`).
- **Dry-Run Package Validation:** Use `npm run release:dry-run` to inspect package contents without creating archives or contacting a registry.
- **Hardware Verification Status:** PlatformIO compile success is not hardware verification. Statuses in `hardware/catalog.json` remain `COMPILE_TESTED` until an operator records a dated physical test under `hardware/records/`.
