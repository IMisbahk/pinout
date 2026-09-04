# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).

## [Unreleased]

### Added (platform v1 sprint)

- **Spec v1 layer** (`packages/core/src/spec`): canonical versioned contracts — device identity/health/descriptors, capability kinds with danger levels and units, operations, leases, frames/poses, safety constraints with provenance, module manifest shape, support statuses. Deterministic unit conversions that refuse ambiguous conversions. Documented under `docs/spec/`.
- **Long-running operations** (`OperationManager`): queued/running/completed/failed/cancelled/timed_out/rejected lifecycle, idempotency keys that permanently dedupe client retries, deadlines, cooperative cancellation that only reports cancelled when the run acknowledges it, progress reporting with per-operation snapshots and `AsyncIterable` streams.
- **Resource leases** (`LeaseManager`): exclusive and shared-read modes, device- and capability-scoped leases, TTL/renew/release/expiry so crashed agents cannot hold hardware.
- **Safety engine v2** (`SafetyEngine`): rate, interlock, sequence, approval, lease, deadman, and resource-budget policies on top of the legacy range/state/workspace rules, with structured `SAFETY_*` codes and `mergeModuleAndDeploymentRules` that only lets deployments tighten module baselines (widening/contradictions become conflicts for human review).
- **Halt/E-stop coordinator** (`HaltCoordinator`): `NORMAL | RESTRICTED | HALTED | ESTOP_REQUESTED | FAULTED` with sticky estop (clear then resume), audited state transitions, and honest non-certification documentation.
- **DeviceGraph**: composition with parent/child links, cycle rejection, dotted addressing across vendors (`robot-cell-01.arm.motion.move_to`), and queries by class/capability/module/tag/parent/simulation.
- **Control journal** (`Journal`): append-only record of invocations, policy rejections, operations, faults, safety transitions, and lease activity; secret-shaped keys redacted, oversized payloads truncated; memory + JSONL storage, replay loading, and sequence hydration after restart.
- **Stream bus** (`StreamBus`): data-plane frame fan-out with `drop-oldest` / `drop-latest` / `latest-only` backpressure, snapshots, stream registration and close semantics.
- **`pinoutd` daemon** (`packages/daemon`): loopback-only local execution service with HTTP API (devices, invoke with dry-run and idempotency, operations, leases, halt/estop, SSE events, stream metadata, journal), bearer-token auth, refusal to bind non-loopback without explicit remote opt-in plus token.
- **Python SDK** (`sdk/python`): stdlib-only sync client plus asyncio client (httpx extra) with typed errors, operations with progress/cancel, leases, safety controls, SSE event streams; tested against an in-process mock daemon.
- **Modbus adapter** (`packages/protocols-modbus`): zero-dependency Modbus TCP (MBAP) and RTU (CRC16) clients, exception mapping to stable codes, and declarative register maps where unknown/read-only registers never become writable.
- **SCPI layer** (`packages/protocols-scpi`): SCPI parser with mnemonic abbreviation and channel syntax, sequential-queue client over any transport with error-queue draining, and reference instrument classes (power supply, DMM, function generator, conservative oscilloscope) with an explicit-opt-in raw escape hatch.
- **UDP and WebSocket transports** in core, with datagram exchange, idle close, reconnect with exponential backoff (never on explicit close), and structured logging.
- **MicroPython bridge** (`firmware/micropython-bridge`): board-agnostic NDJSON bridge with runtime capability detection, software pin-state shadow, UART (hardware) and stdio (host) modes, host-side protocol validation (`validate.js`), and a data-driven board descriptor.
- **CLI daemon commands**: `daemon status`, `halt`, `resume`, `estop`, `estop-clear`, `lease acquire/list/release`, `operations`, `logs`, plus a global `--url` flag talking to `pinoutd`.
- **Protocol-neutral tool export** (`runtimeToToolDefinitions`): every capability as a tool definition with derived danger classification for any AI vendor's function-call format.
- **Runtime integration**: `DeviceInstance.invoke` now runs the halt gate, v2 safety rules, and lease checks, and supports `dryRun` and `owner` options.
- **CI**: OS (Linux/macOS/Windows) × Node (20/22) matrix, Python SDK job (3.10/3.12), and MicroPython bridge protocol validation.
- Baseline record in `docs/mega-sprint-baseline.md`; spec docs in `docs/spec/`; daemon guide in `docs/daemon.md`.

### Changed (platform v1 sprint)

- License changed from MIT to Apache-2.0; repository metadata points at `pinoutlabs/pinout`; NOTICE, Code of Conduct, and Support documents added.
- README updated to describe the full platform surface with an honest hardware support catalog; support statuses never conflate simulated, implemented, and hardware-verified.


### Added (hardware intelligence platform)

- Multi-driver composite devices with explicit capability routing, driver-attributed events, aggregated operational state, and fail-closed route validation.
- First-party simulated semantic modules for relays, proportional valves, pumps, and programmable power supplies.
- ESP32 bridge firmware 0.3.0 with validated `gpio.batchWrite`, best-effort `gpio.stopAll`, and non-blocking cancellable pulses.
- Runtime MCP discovery tools for device inventory and capability/state inspection.
- Operator CLI commands: `runtime inspect`, `runtime capabilities`, `runtime tools`, and confirmation-gated `runtime emergency-stop`.
- Capability output-schema enforcement and concurrency-aware device lifecycle reporting.
- Module entrypoint and registry-path containment checks, including symlink and tampered-index regression coverage.
- Company, product, production-architecture, security, demo, and roadmap documents.

### Changed

- MCP marks every physical-output tool as destructive, never infers idempotency from reversibility, and fails closed on normalized tool-name collisions.
- The robotics demo explicitly identifies every device as simulated and reports the discovered agent surface.

### Added (Sprint 5 — robotics parts)

- First-party actuator modules: `pinout/dc-motor`, `pinout/servo`, `pinout/stepper`.
- Semantic families `motor.*`, `servo.*`, `stepper.*` with speed/angle/step policies.
- Generator maps vendor motor/servo/stepper symbols onto those families.
- ESP32 bridge firmware 0.2.0: `i2c.begin|write|read|scan` and `spi.begin|transfer`.
- SDK/simulator pin rules for I2C/SPI buses (defaults SDA 21 / SCL 22, HSPI pins).
- ESP32 `gpio.servo` and `gpio.motor` pin-level actuator driving (distinct from standalone modules).
- First-party sensor modules: `pinout/distance`, `pinout/imu`, `pinout/encoder`, `pinout/limit-switch`, `pinout/force`.
- First-party mobile base (`pinout/mobile-base`) with `drive.set_velocity` / `drive.stop` and velocity policies.
- `createRoboticsWorkbench()` registers the lab set plus actuators, sensors, and a differential-drive base.
- `npm run demo:robotics` canonical robotics-parts demo.

### Added (Sprint 4 — module generator)

- `@pinout/generator` package: documentation/SDK → Hardware Interface IR → candidate module.
- Hardware Interface IR with evidence, confidence, uncertainties, and safety extraction.
- Source ingestion for text, Markdown, source code, JSON/YAML, and directories.
- Semantic capability mapper (`temperature.*`, `motion.*`, `gripper.*`, …).
- LLM provider abstraction: deterministic `mock` (CI) and OpenAI-compatible `http`.
- CLI: `pinout generate <source>` with `--plan`, `--output`, `--provider`, `--model`, `--test`.
- Generated module layout: manifest, backend, simulator, tests, `GENERATION_REPORT.md`, provenance.
- Fixture vendor SDKs and evaluation harness under `fixtures/generator/`.
- Documentation: [generator.md](docs/generator.md), [generator-safety.md](docs/generator-safety.md).

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

### Changed (Sprint 3)

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

[Unreleased]: https://github.com/IMisbahk/pinout/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/IMisbahk/pinout/releases/tag/v0.1.0
