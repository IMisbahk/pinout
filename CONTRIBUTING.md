# Contributing

Pinout is early. Small, correct changes beat large speculative ones.

## Setup

Node 20+ is required.

```bash
npm install
npm test
npm run lint
npm run typecheck
npm run build
```

Copy [.env.example](.env.example) when working with serial hardware.

## Layout

- `packages/core` — SDK, protocol, transports, ESP32 pin rules, simulator
- `packages/cli` — `pinout` CLI
- `packages/mcp` — MCP stdio server (wraps `connect()` + `invoke()`)
- `firmware/esp32-bridge` — ESP32 firmware
- `docs/` — architecture, protocol, capabilities, CLI, testing
- `examples/` — SDK usage and [external-module/weird-sensor](examples/external-module/weird-sensor) reference driver

External hardware modules should live **outside** `packages/core`. Use `defineModule` from the public SDK and validate with `pinout module test`.

## Rules of thumb

1. Keep `@pinout/core` free of product-specific robotics stacks. Drivers own board knowledge.
2. New hardware actions are capabilities (`name` + schemas + safety), not new core types.
3. Transports move bytes. They do not parse GPIO commands.
4. If CI cannot run it, provide a simulator that uses the same interfaces.
5. Do not add packages, frameworks, or cloud infrastructure "for later."
6. Variable and function names are camelCase.
7. Add `@modelcontextprotocol/sdk` only inside `packages/mcp`.

## Adding a capability

Work in one vertical slice when possible:

1. **Schema** — add the descriptor in `packages/core/src/capabilities.ts` (input/output JSON Schema, safety notes).
2. **Simulator** — implement the action in the ESP32 bridge handler used by `simulatedEsp32()`.
3. **Firmware** — mirror the action in `firmware/esp32-bridge/src/main.cpp` with the same error codes.
4. **SDK validation** — extend `device.invoke()` pin/payload checks if the action needs host-side rules.
5. **CLI** — add a command or subcommand in `packages/cli` if users need it from the shell.
6. **Tests** — protocol/unit tests plus at least one simulator integration test.
7. **Docs** — update [docs/capabilities.md](docs/capabilities.md), [docs/protocol.md](docs/protocol.md), and [CHANGELOG.md](CHANGELOG.md).

MCP tools are generated automatically from the capability catalog; no separate MCP tool list is maintained.

## Tests

See [docs/testing.md](docs/testing.md). Put tests under `packages/<name>/tests`. Prefer:

- protocol encode/decode
- validation
- transport / timeout behavior
- one SDK → simulator integration test

Do not mock away the protocol just to assert that a mock was called.

Firmware compile (`pio run` in `firmware/esp32-bridge`) is optional locally. CI attempts it but does not block merges if PlatformIO is unavailable.

## Hardware

See [firmware/esp32-bridge/README.md](firmware/esp32-bridge/README.md) and [docs/protocol.md](docs/protocol.md).

If you change the protocol, update firmware, simulator, SDK, tests, and docs in the same change.

## Pull requests

Target `main`. Wait for CI. Do not merge your own experimental work without review while the project is this small.
