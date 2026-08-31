# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (Sprint 3 — module ecosystem)

- Public Module SDK: `defineModule`, `action`, `sensorRead`, declarative policies.
- `pinout.module.json` manifest format with schema and Pinout version compatibility.
- Local module registry (`~/.pinout/modules/`) with install/list/inspect/uninstall.
- Persistent device configuration (`~/.pinout/devices.json`) and `PinoutRuntime.fromConfig()`.
- Module conformance kit: `pinout module test`.
- CLI: `module create|test|install|list|inspect`, `device add|remove|list|inspect`.
- CLI: `pinout devices` (runtime devices), `pinout ports` (serial discovery), `pinout invoke`.
- Reference external module: [examples/external-module/weird-sensor](examples/external-module/weird-sensor).
- MCP bootstrap via `PINOUT_CONFIG` without `@pinout/mcp` changes.
- Documentation: [build-a-module.md](docs/build-a-module.md).

### Changed

- Single-device invoke renamed to `pinout exec <action>` (runtime uses `pinout invoke`).

### Added (Sprint 2 — heterogeneous runtime)

- `PinoutRuntime` multi-device registry with unified events.
- Module abstraction: ESP32 refactored as `pinout/esp32` module.
- Simulated robot manipulator (`motion.*`, `gripper.*`, `pose.*`).
- Simulated environmental chamber (`temperature.*`, `door.*`, `experiment.*`).
- Generic policy engine (`POLICY_CONSTRAINT_VIOLATION`, `POLICY_PRECONDITION_FAILED`).
- Dynamic MCP tools from runtime (`PINOUT_DEMO=heterogeneous`).
- CLI `runtime devices` and `runtime invoke`.
- `npm run demo:heterogeneous` canonical demo.
- Documentation: [modules.md](docs/modules.md), [policies.md](docs/policies.md).

### Added (Sprint 1 — v0 foundation)
- Device event API (`on` / `off` / `once`) including `gpio.changed`.
- GPIO family: mode, toggle, pulse, PWM, analogRead, watch/unwatch.
- Loopback and TCP transports; CLI `doctor`, `invoke`, `pins`, `run`, `blink`.
- ESP32 GPIO 12 strap pin refused in SDK and firmware.
- Shared protocol codecs: `encodeResponse`, `encodeEvent`, `maxProtocolLineBytes`.
- Documentation: capability catalog, CLI reference, testing guide.
- `npm run test:coverage` with Vitest v8 coverage for `@pinout/core`.
- `npm run mcp` script for local MCP server development (simulator by default).
- CI firmware compile job via PlatformIO (compile-only, no upload).
- CI `format:check` gate.

### Fixed

- Serial port `error` events now propagate through the session to in-flight requests.

## [0.1.0] — 2026-01-01

### Added

- `@pinout/core` — Device API, protocol v1 NDJSON, ESP32 pin rules, simulated transport.
- `@pinout/cli` — `devices`, `hello`, `gpio write`, `gpio read`.
- ESP32 bridge firmware speaking protocol v1 over UART.
- `examples/blink.ts` sample.

[Unreleased]: https://github.com/imisbahk/pinout/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/imisbahk/pinout/releases/tag/v0.1.0
