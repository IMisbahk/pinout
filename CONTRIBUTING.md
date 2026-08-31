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

## Layout

- `packages/core` — SDK, protocol, transports, ESP32 pin rules, simulator
- `packages/cli` — `pinout` CLI
- `firmware/esp32-bridge` — ESP32 firmware
- `docs/` — architecture and protocol
- `examples/` — SDK usage

## Rules of thumb

1. Keep `@pinout/core` free of product-specific robotics stacks. Drivers own board knowledge.
2. New hardware actions are capabilities (`name` + schemas + safety), not new core types.
3. Transports move bytes. They do not parse GPIO commands.
4. If CI cannot run it, provide a simulator that uses the same interfaces.
5. Do not add packages, frameworks, or cloud infrastructure "for later."
6. Variable and function names are camelCase.

## Tests

Put tests next to the package under `packages/<name>/tests`. Prefer:

- protocol encode/decode
- validation
- transport / timeout behavior
- one SDK → simulator integration test

Do not mock away the protocol just to assert that a mock was called.

## Hardware

See [firmware/esp32-bridge/README.md](firmware/esp32-bridge/README.md) and [docs/protocol.md](docs/protocol.md).

If you change the protocol, update firmware, simulator, SDK, tests, and docs in the same change.

## Pull requests

Target `main`. Wait for CI. Do not merge your own experimental work without review while the project is this small.
