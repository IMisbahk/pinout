# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added

- Structured logger, env config (`PINOUT_PORT`, `PINOUT_BAUD`, `PINOUT_TIMEOUT`, `PINOUT_LOG_LEVEL`).
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
