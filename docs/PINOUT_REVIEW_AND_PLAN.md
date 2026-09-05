# Pinout: honest review and execution plan

Reviewed 2026-09-05 at `64d69cc`. Scope: source inspection, full JS test suite, build, and real MCP subprocess initialization; no hardware actuation or firmware compilation in this review. This is a prioritized implementation brief, not a claim that the roadmap is complete.

## Verdict and product direction

Pinout is an ambitious early hardware capability runtime with a substantial software foundation and insufficient physical validation. It already goes beyond an ESP32 library, but it has not yet demonstrated the dependable, effortless agent-to-circuit experience that should define the product. The repository is broader than its hardware evidence.

The proposed positioning is: **Pinout lets agents discover, operate, and observe configured hardware through typed tools, with execution rules enforced outside the model.** MCP is one adapter; the device contract and reliable execution are the product.

“No hardware code” can be true for the agent's user after someone provides a working module, wiring configuration, calibration, and limits. It cannot honestly mean any arbitrary circuit becomes understandable merely by plugging it in. USB discovery identifies a board, not the circuit attached to its pins. Hide those details behind commissioned capabilities such as `lamp.set`, not a prompt asking the agent to choose GPIOs.

## What exists

| Area | Assessment and source |
| --- | --- |
| Runtime | Typed capabilities, schema/policy enforcement, state/events, composition, leases, operations, journal/recovery, frames and streams exist in `packages/core/src/`. Strong foundation; presence is not proof of every failure guarantee. |
| Access | Daemon HTTP/SSE, CLI, Python SDK, and capability-derived MCP tools. Daemon-first architecture is the right direction (`docs/adr/0002-control-plane-topology.md`). |
| Hardware | Classic ESP32 bridge implements GPIO/PWM/ADC/I2C/SPI and servo/motor commands. Catalog status is `COMPILE_TESTED`; `hardware/records/2026-09-04-esp32-classic-pending.md` explicitly says physical tests were not run. ESP32 is the most developed path, not yet a verified product. |
| Breadth | Robot arm/base, instruments and other semantic devices mostly run simulators. Modbus, SCPI, MQTT and GRBL packages exist; adapter implementation does not imply a configured, physically tested runtime device. See `hardware/catalog.json`. |
| Extensibility | External modules, Node/Python hosting, integrity checks, discovery, and docs-to-module generation. Useful future ecosystem infrastructure; generated integrations still need review and physical validation. |

Fresh checks: `npm run build` passed; `npm test` passed **76 files / 599 tests**. These prove software checks, not physical reliability. No latency or inference-throughput claim was established.

## Concrete findings

1. **P0: shipped MCP startup is broken in the tested path.** `packages/mcp/src/runStdio.ts` calls `await shutdown()` immediately after `await server.connect(transport)`. SDK connection setup does not wait for the session to end. A real SDK Client launched against `packages/mcp/dist/index.js` fails initialization with `MCP error -32000: Connection closed`. Fix lifecycle handling across default, embedded and demo paths; unit tests currently miss this process boundary.
2. **P0 before sustained actuation: host loss has no device-local expiry.** The firmware loop polls watches, pulses and serial; no command heartbeat/deadman watchdog was found. `ProtocolDeviceBackend.safeState()` sends `gpio.stopAll`, which cannot protect against a dead host or severed link. Add a device-local expiry contract. This is a gap in protection, not evidence that a physical incident occurred.
3. **Safe state must describe the attached circuit.** Firmware `handleGpioStopAll` drives active digital pins LOW and detaches PWM. LOW can energize an active-low load; PWM removal does not establish mechanical safety. A module must declare commissioned safe outputs and supported stop behavior. Reject unsupported configurations rather than assuming LOW means off.
4. **Physical state needs an explicit evidence contract.** `ProtocolDeviceBackend.getOperationalState()` returns firmware/protocol metadata. GPIO readback and watch events exist, but neither establishes that a lamp illuminated or a gripper held an object. Model commanded, acknowledged and independently observed state separately; preserve unknown and stale values.
5. **Avoid another breadth sprint.** More protocol names, simulators or generator features will not close the main product gap. The defensible asset would be trusted device contracts, reproducible commissioning, physical test evidence and predictable recovery.

## Humanoid direction: retain the ambition, change the milestone

A humanoid is a separate mechanical, controls, perception, power and embodied-learning program. This repository alone does not substantiate a one-to-two-year humanoid delivery promise. A credible nearer milestone is an agent reliably performing bounded physical tasks on an existing arm or mobile platform through Pinout.

Use this architecture:

`On-device agent → Pinout skill/capability requests → robot controller → actuators`

`Sensors → perception/state estimation → controller + timestamped observations for Pinout`

Pinout should own discovery, permissions, task admission, resource ownership, execution lifecycle and observation. Controllers should own trajectories, feedback loops, balance and immediate protective behavior. Existing ROS 2 actions already provide goals, feedback and cancellation; bridge these rather than inventing a competing robotics stack ([ROS 2 actions](https://docs.ros.org/en/rolling/Concepts/Basic/About-Actions.html)). Controller timing requires low jitter ([ros2_control](https://control.ros.org/jazzy/doc/ros2_control/controller_manager/doc/userdoc.html)).

Thousands of tokens/second is an aspiration, not a control requirement or verified chip capability. Specify model, precision, context, single-stream latency, power and thermal budget before selecting inference hardware. Measure time from observation to a valid decision and physical task success. Keep inference replaceable and benchmark it separately from Pinout overhead.

## Ordered plan for a coding agent

Implement phases in order. Extend existing contracts; do not rebuild implemented infrastructure. Each phase requires code, focused failure tests, documentation and recorded evidence. Hardware-dependent acceptance remains pending until actually performed.

### Phase 1 — Repair the usable agent entrypoint

- Fix MCP startup/shutdown in `packages/mcp/src/runStdio.ts`; maintain transport lifetime and close once on EOF/signals.
- Add subprocess tests using the actual MCP SDK client and built entrypoint. With an isolated simulator daemon: initialize, list tools, describe a device, acquire a lease, invoke, read state, close. Check embedded/demo lifetimes and daemon-unavailable errors too.
- Audit existing CLI/Python/MCP routes for consistent daemon governance; document intentional low-level SDK access.
- Acceptance: a fresh client completes the above flow, stays connected between calls, exits cleanly, and handles missing daemon without an unexplained transport closure.

### Phase 2 — Establish a reliable ESP32 reference circuit

- Extend firmware/protocol/host code with negotiated watchdog support, bounded command validity, explicit arming and per-output safe-state configuration. Older firmware must not silently advertise these guarantees.
- Specify behavior for boot, host crash, expiry, disconnect, reconnect and reset; no automatic resumption of actuation after recovery. Bound blocking handlers so watchdog service remains timely.
- Provide a documented low-voltage LED + input-sensor reference configuration, including exact board variant, wiring, polarity and firmware identity. Never auto-flash an unidentified board.
- Acceptance: compile and simulator/protocol tests first, then follow `scripts/hil/esp32-classic.md`. Record handshake, output/readback, sensor events, invalid pin rejection, host kill, unplug, expiry and reconnect. Measure configured-expiry-to-output response; record physical observations separately from acknowledgments. Include an active-low fixture or retain that coverage as pending.

### Phase 3 — Deliver the actual abstraction

- Build a commissioned `lamp` module over the verified ESP32 path with semantic on/off/status capabilities, limits and explicit simulation provenance. Keep wiring in deployment configuration.
- Extend existing state contracts with source, observation timestamp, freshness and commanded/acknowledged/observed distinctions. Reject actions dependent on missing or stale prerequisites. Do not infer physical success from a successful write.
- Add a setup/doctor workflow that explains missing firmware, configuration and connectivity without actuating during discovery.
- Acceptance: an agent given only MCP tool access and a task description discovers the lamp, operates it and reports the available verification honestly. Save transcript and hardware evidence. A second tester repeats setup without repository-code guidance. Proposed target: under 15 minutes after wiring and firmware preparation; measure rather than claim it.

### Phase 4 — Prove recovery and portability

- Audit existing operation persistence, idempotency, leases and halt behavior before adding replacements. Test crash before dispatch, after dispatch/before acknowledgment, and after completion/before client receipt.
- Preserve uncertain physical outcomes across restart; require reconciliation rather than blindly replaying non-idempotent actions. Distinguish cancellation requested from device-confirmed stop.
- Add one second physical backend chosen from hardware actually available. Reuse the semantic contract through an existing adapter where possible.
- Acceptance: competing owners cannot actuate the same leased resource; stale/restarted sessions cannot resume commands silently; ambiguous outcomes remain visible; both backends pass a shared conformance suite plus their own dated hardware tests.

### Phase 5 — Robotics integration, after the preceding gates

- Implement a narrow ROS 2 sidecar mapping one existing robot action to Pinout operations, feedback, cancellation and controller-confirmed result. Reuse existing frames/units/stream abstractions; reject missing frames and stale transforms.
- Keep camera/high-rate sensor data off MCP; expose timestamped summaries and stream references. Scope advertised skills to actual controller support.
- Acceptance: one bounded manipulation task first in an external simulator, then on an available physical platform. Exercise controller loss, cancellation, stale perception and independent stop. Report success rate, p50/p95/p99 command overhead and observed stop response under load; define task-specific limits before the physical run.

## Deliberately defer

Do not build a custom inference chip, motor-control stack, humanoid body, cloud fleet product, large hardware catalog, or autonomous driver installation as part of this plan. Do not claim universal plug-and-play, exactly-once physical effects, certified safety or hardware support from simulator tests. Expand generator/catalog investment when real integrations demonstrate repeatable demand.

Suggested sequencing: phases 1–3 are the next product milestone; phase 4 earns portability; phase 5 earns a robotics claim. A 12–24 month direction can target dependable embodied skills on existing hardware, with a humanoid program separately scoped and funded.

## Handoff instructions

Start by reading repository instructions and checking the current diff. Reproduce the MCP failure, then implement phase 1. Track every acceptance item as passed, failed or blocked with evidence. Continue software work where possible when hardware is unavailable, but never mark physical gates passed. Run relevant tests and final build, test, test-typecheck, lint and docs checks. Preserve unrelated edits, make logical local commits, and do not push, publish or tag without explicit authorization. Update stale roadmap/ledger claims to match verified outcomes.
