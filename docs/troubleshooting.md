# Troubleshooting

## Doctor Diagnostics & Remedy Mapping

Use `pinout doctor` for staged, non-actuating diagnostics of environment, daemon, serial ports, firmware identity, and configuration. Below is the mapping from every doctor `FAIL` or `WARN` message to its remedy:

| Stage | Doctor Message | Status | Cause & Remedy |
| :--- | :--- | :--- | :--- |
| **Environment** | `node-version: vX.Y.Z is below required Node.js 20+` | `FAIL` | Node.js runtime is too old. Upgrade to Node.js $\ge 20.0.0$ via nvm, fnm, or [nodejs.org](https://nodejs.org). |
| **Environment** | `pinout-home: ~/.pinout is not writable` | `FAIL` | The Pinout configuration directory is unwritable. Grant write permissions (`chmod 700 ~/.pinout`) or set `PINOUT_HOME` to a writable path. |
| **Daemon** | `daemon-health: Cannot reach Pinout daemon at <url>` | `WARN` / `FAIL` | `pinoutd` execution daemon is not running on the target URL. Start it with `node packages/daemon/dist/main.js --demo` or `pinoutd`. If running standalone direct commands, pass `--no-daemon`. |
| **Daemon** | `daemon-health: Daemon rejected authentication (HTTP 401/403)` | `FAIL` | The daemon requires bearer token authentication. Verify that the `PINOUT_TOKEN` environment variable matches the daemon configuration. |
| **Discovery** | `serial-ports: No serial ports detected on host` | `WARN` | No USB serial devices found. Check your USB cable (must carry data, not power-only), ensure USB drivers (CP210x or CH340) are installed, or pass `--mock` for simulation. |
| **Discovery** | `board-match: Port <path>: unidentified board (VID:xxxx PID:yyyy)` | `WARN` | The attached USB bridge does not match a known board descriptor in `firmware/boards/`. **Pinout will never auto-flash unidentified boards.** Visually confirm board model and flash manually via PlatformIO (`pio run -e esp32dev -t upload`). |
| **Firmware** | `firmware-identity: No Pinout firmware responded on <path>` | `FAIL` | The serial port is open, but no valid Pinout firmware replied to `sys.hello`. Verify baud rate is 115200, check serial cable, and manually flash firmware per [`firmware/esp32-bridge/README.md`](../firmware/esp32-bridge/README.md). |
| **Firmware** | `firmware-identity: Protocol version mismatch on <path>` | `FAIL` | Device reports a protocol version different from host SDK ($v1$). Re-flash matching bridge firmware or update the Pinout SDK. |
| **Firmware** | `firmware-identity: Firmware does not advertise watchdog/arming` | `WARN` | Device is running legacy firmware without the negotiated watchdog and explicit arming safety features. Sustained actuation is not supported. Update to latest firmware. |
| **Configuration** | `enrolled-devices: No devices configured in ~/.pinout/devices.json` | `WARN` | Registry is empty. Enroll your device using `pinout enroll --id <id> --port <path>` (or `--mock`) or follow [`docs/setup.md`](setup.md). |
| **Configuration** | `device:<id>: Device expects port '<path>' which is not currently detected` | `WARN` | A previously enrolled device's USB port is disconnected. Reconnect the hardware or update the transport path in `~/.pinout/devices.json`. |
| **Simulator** | `mock-handshake: Simulator handshake failed` | `FAIL` | Internal simulation transport error. Rebuild package dependencies with `npm run build`. |

---

## Hardware & Serial Operational Issues

- **Daemon Reachability:** Confirm the daemon is reachable on its configured loopback URL and inspect `pinout daemon status`.
- **Serial Reset on Connect:** A serial connect can reset classic ESP32 boards through DTR/RTS lines. Reconnect with `resetOnConnect: false` or wait for the device boot lifecycle to settle before sending commands.
- **Unidentified Serial Ports & Flashing:** Pinout tools never automatically flash firmware to connected serial devices. If a port does not respond to `pinout hello` or enrollment fails, visually inspect the board, check the USB VID/PID against `firmware/boards/`, and manually flash using PlatformIO (`cd firmware/esp32-bridge && pio run -e esp32dev -t upload`).
- **Firmware Identity & Protocol Mismatches:** If `pinout hello` returns an unexpected firmware name or protocol version, verify that the board is running `firmware/esp32-bridge` (reporting `firmware: "esp32-bridge"`, `protocol: 1`).
- **Dry-Run Package Validation:** Use `npm run release:dry-run` to inspect package contents without creating archives or contacting a registry.
- **Hardware Verification Status:** PlatformIO compile success is not hardware verification. Statuses in `hardware/catalog.json` remain `COMPILE_TESTED` until an operator records a dated physical test under `hardware/records/`.
