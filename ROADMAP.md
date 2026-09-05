# Roadmap

This is an evidence-backed roadmap and direction, not a promise or release schedule. Items move strictly when implementation, test suites, and documentation support them.

All completed vs pending items are tracked with evidence in the [Acceptance Ledger](docs/acceptance-ledger.md).

---

## Current Status (Phases 1–5 Implementation Completed in Software)

- **Phase 1 — Usable Agent Entrypoint (PASSED):** Repaired MCP stdio lifecycle (stays connected across requests, clean exit on EOF/signals), added subprocess client integration tests, unified daemon control plane governance (`PINOUT_DAEMON_URL`, `PINOUT_OWNER`), and documented intentional direct SDK bypass semantics ([ADR 0006](docs/adr/0006-daemon-governance-and-direct-access.md)).
- **Phase 2 — ESP32 Reference Protocol & Safety Contracts (Software PASSED; Hardware PENDING):** Negotiated deadman host-loss watchdog (`watchdog.kick`), explicit arming state machine (`sys.arm`/`sys.disarm`, no implicit auto-arming), circuit-aware per-pin safe state (`gpio.configSafeState`), 1024-byte protocol line limit, reference circuit fixture specification ([docs](hardware/reference/esp32-classic-led-sensor.md)), HIL procedure ([docs](scripts/hil/esp32-classic.md)), and strict refusal to auto-flash unidentified hardware. Physical HIL execution remains pending hardware bench trials ([pending record](hardware/records/2026-09-05-esp32-classic-reference-circuit-pending.md)).
- **Phase 3 — Commissioned Abstractions & State Evidence (Software PASSED; Hardware PENDING):** Delivered commissioned `pinout/lamp` module over ESP32 and simulation with semantic capabilities (`lamp.arm`, `lamp.disarm`, `lamp.on`, `lamp.off`, `lamp.set`, `lamp.status`); established physical evidence state contract (`commanded`, `acknowledged`, `observed`, `freshnessMs`, `stale`) with strict refusal to infer physical effect from writes; added non-actuating `pinout doctor` diagnostic workflow and setup guide ([docs/setup.md](docs/setup.md)). Live agent transcripts and 15-minute second-tester trials on physical hardware remain pending.
- **Phase 4 — Recovery, Reconciliation & Portability (Software PASSED; Hardware PENDING):** Hardened operation recovery across crash windows A/B/C with mandatory operator reconciliation for uncertain outcomes ([ADR 0007](docs/adr/0007-reconciliation-required-for-uncertain-operations.md)); volatile lease clearing across restart; confirmed vs unconfirmed cancellation; second physical backend over Modbus TCP/RTU with discrete input readback (`@pinout/protocols-modbus`) verified in simulation via shared conformance suite `runLampConformance`. Physical hardware execution for both backends is pending.
- **Phase 5 — Robotics Integration / Sidecar Boundary (Simulator PASSED; Hardware PENDING):** Delivered narrow `@pinout/ros2-sidecar` mapping one bounded Cartesian action (`arm.move_to_pose`) and stop (`arm.stop`) over zero-dependency transport abstraction ([ADR 0008](docs/adr/0008-ros2-sidecar-boundary.md)); frame tree validation (`FRAME_MISSING`) and transform freshness gating (`TRANSFORM_STALE`); high-rate telemetry isolated to `StreamBus`; controller loss handled as `requires_reconciliation`; benchmark passed declared limits (overhead p99 <= 15 ms, stop response p99 <= 30 ms). External simulator and physical manipulator testing remain blocked.

---

## Next: Physical HIL Execution & Commissioning

- Conduct operator-observed, instrumented HIL runs for the ESP32 classic reference circuit using oscilloscope/logic analyzer timing captures ($\le 1\text{ ms}$ precision).
- Execute physical bench validation of the Modbus lamp backend with physical Remote I/O units.
- Record live MCP agent discovery and actuation transcripts on physical hardware.
- Conduct timed 15-minute setup trials with independent second testers following [docs/setup.md](docs/setup.md).
- Integrate external robotics simulation (Gazebo / Isaac Sim) with the ROS 2 sidecar transport.

---

## Later: Production & Fleet Path

- Deployment profiles for isolated runtimes, mutual TLS authentication, network segmentation, and operator controls.
- Durable audit export and policy administration suitable for enterprise review.
- Fleet identity, health, and rollout workflows after threat models and operational contracts are specified.
- Certified or regulated safety integration only with external safety engineering; no certification or mains equipment readiness is claimed today.

---

## Explicit Non-Goals for this Repository

- Universal "plug-and-play" claims (discovery identifies boards/controllers, never arbitrary attached circuits without explicit commissioning).
- "Exactly-once" physical actuation guarantees (physical power/network loss produces uncertain outcomes requiring explicit reconciliation).
- Private vendor control-plane emulation or autonomous safety guarantees inside LLM models.
- Shipped hardware product claims based solely on software simulators or compile tests.
