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
- `packages/mcp` — MCP stdio adapter over the daemon control plane (embedded mode is for demos)
- `packages/generator` — hardware documentation → candidate module compiler
- `firmware/esp32-bridge` — ESP32 firmware
- `docs/` — architecture, protocol, capabilities, CLI, testing, generator
- `examples/` — SDK usage and [external-module/weird-sensor](examples/external-module/weird-sensor) reference driver
- `fixtures/generator/` — vendor SDK fixtures for generator evaluation

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

Firmware compile (`pio run` in `firmware/esp32-bridge`) is optional locally. The
selected CI run compiles the reference classic target and uploads its artifacts;
the experimental C3 target is compiled only by the manual release-candidate
workflow.

## Hardware

See [firmware/esp32-bridge/README.md](firmware/esp32-bridge/README.md) and [docs/protocol.md](docs/protocol.md).

If you change the protocol, update firmware, simulator, SDK, tests, and docs in the same change.

## Pull requests

Target `main` and keep each PR focused. A maintainer reviews the proposal first;
CI is intentionally gated to conserve Actions minutes. After review, the
maintainer applies the `ci:run` label (or manually dispatches the CI workflow)
to run the full matrix against the PR merge ref. Do not treat a skipped check
as approval, and do not merge until the selected run is green and a maintainer
has approved the PR.

The gated workflow deliberately has no deployment or release secrets. Fork PRs
are still untrusted code: never add credentials to a test workflow or ask a PR
to print environment variables.

## Issues and triage

Open one issue per focused bug or proposal. Include a safe reproduction, the
commit/package version, and the evidence level (`SIMULATED`, `COMPILE_TESTED`,
or hardware-recorded). Do not disclose vulnerabilities or credentials in an
issue; use the private security route in [SECURITY.md](SECURITY.md).

Maintainers use the `triage` label while reviewing scope, then add `ci:run`
only when a PR is ready for the Actions gate. See the [maintainer guide](docs/maintainers.md)
for the full review sequence.
