# Mega Sprint Baseline

Recorded at sprint start. Branch: `feat/pinout-platform-v1` (cut from `main` at `ed61401`).

## Baseline facts (verified by running, not by trusting docs)

- **Tests**: 30 test files, 174 tests, all passing (`npm test`, vitest, ~12.7s).
- **Build**: `tsc -b` clean; `npm run lint` and `npm run format:check` clean.
- **Firmware**: single target `firmware/esp32-bridge` (ESP32 Arduino), compile-only in CI.

## Packages (npm workspaces)

| Package | Version | Notes |
| --- | --- | --- |
| `@pinout/core` | 0.2.0 | runtime, modules, policies, transports, module SDK, config, home stores. Depends on `serialport`. |
| `@pinout/cli` | 0.1.0 | `commander`-based CLI: devices, invoke, modules, home, generate. |
| `@pinout/generator` | 0.1.0 | hardware-doc → module candidate pipeline (Hardware IR). |
| `@pinout/mcp` | 0.1.0 | MCP adapter over runtime agent tools. |

## Existing feature surface

- Heterogeneous runtime (`createHeterogeneousRuntime`, `createRoboticsWorkbench`, composite).
- ~18 first-party modules (esp32, servo, dc motor, stepper, relay, pump, valve, chamber,
  power supply, distance, IMU, encoder, limit switch, force, robot arm, mobile base, …).
- Policy engine with `numericRange`, `stateEquals`, `workspaceBounds`, custom rules.
- Transports: serial, TCP, loopback. Byte queue + line reader framing.
- Module SDK (`defineModule`), manifest validation, conformance kit, local registry, home stores.
- Generator pipeline + fixture (`fixtures/generator/heatbox-sdk`), live-provider eval hooks.
- MCP bootstrap script (`scripts/mcp-bootstrap.js`).
- Examples: blink, pwm, analog, watch, script, agent-tools, heterogeneous, robotics-parts,
  multi-driver-rig, mcp-heterogeneous, external-module.

## Known architectural debt / gaps (drivers for this sprint)

1. **No first-class long-running operations** — invoke is request/response; motion-like
   actions cannot report progress, be cancelled safely, or dedupe retries.
2. **No resource leases** — concurrent agents can race on the same actuator.
3. **Safety policies are flat** — no rate/interlock/sequence/approval/deadman policies,
   no constraint provenance, no module-vs-deployment strictness rules.
4. **No halt/estop semantics** — no global safety state machine.
5. **No device composition / DeviceGraph** — no parent/children addressing.
6. **No control journal / replay** — stdout logs only.
7. **No data plane** — high-rate streams would have to ride the control path.
8. **No daemon** — runtime lives in-process per client; no `pinoutd`, no local API.
9. **No Python story** — robotics/scientific ecosystems are Python-first.
10. **Errors are ad hoc** — codes exist but no stable taxonomy with retryability.
11. **Transports lack reconnect/timeout/abort discipline** uniformly.
12. **No spec layer** — types are inferred from implementation, not canonical contracts.

## Repo metadata state at baseline

- License was MIT (now Apache-2.0), repository URLs pointed at personal fork
  (now `pinoutlabs/pinout`), CI had Node 20 single-matrix + ESP32 compile job.

## Baseline command results

```
npm test          → 174 passed
npm run build     → success
npm run lint      → success
npm run typecheck → success
```
