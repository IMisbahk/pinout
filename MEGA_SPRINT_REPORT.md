# MEGA SPRINT REPORT

The sections below record the original sprint. Subsequent integration fixes,
completed streaming, and current validation are recorded in
[`docs/platform-merge-validation.md`](docs/platform-merge-validation.md).

Branch: `feat/pinout-platform-v1` · HEAD `9b91594` · 58 commits this run · nothing pushed.
All numbers below were measured on this machine; nothing is asserted without a test or a command behind it.

## 1. Executive summary

Pinout now has the full control-plane stack of a physical-intelligence platform: a spec-layered runtime with operations, leases, a safety engine, halt/estop, device composition, a control journal, and a data-plane stream bus; a loopback daemon with an HTTP/SSE API and dry-run; TypeScript and Python SDKs (client + module development); out-of-process module hosting with crash isolation and Ed25519 integrity; protocol adapters (Modbus TCP/RTU, SCPI, GRBL, MQTT); discovery with enforced confidence honesty; a generator reality check measuring **zero fabricated hard safety constraints** across a 7-target corpus; deterministic fuzzing that found and fixed 3 real bugs; reproducible benchmarks; and two hardware-free killer demos. 545 tests pass.

## 2. Baseline

Recorded in `docs/mega-sprint-baseline.md`: 174 tests / 30 files, 4 npm packages, 1 firmware target, MIT license, personal-fork URLs, no operations/leases/safety-v2/daemon/Python.

## 3. Final architecture

```
Intelligence (MCP adapter · tool export · SDKs)
        │
Pinout Core (spec v1 · capabilities · operations · leases · safety engine
             halt coordinator · DeviceGraph · journal · stream bus · frames)
        │                     │
@pinout/daemon (pinoutd)   @pinout/module-host (Node + Python workers,
loopback HTTP + SSE          crash isolation, Ed25519 integrity)
        │
Protocol adapters: Modbus TCP/RTU · SCPI · GRBL · MQTT
Transports: serial · TCP · UDP · WebSocket · loopback
Firmware: ESP32 bridge · MicroPython bridge · board descriptors (data)
```

## 4–5. Packages created / changed

Created: `@pinout/daemon`, `@pinout/module-host`, `@pinout/discovery`, `@pinout/protocols-modbus`, `@pinout/protocols-scpi`, `@pinout/protocols-grbl`, `@pinout/protocols-mqtt`, `sdk/python`, `sdk/python-module`.
Changed: `@pinout/core` (spec, operations, leases, safety v2, halt, graph, journal, streams, frames, boards, idempotency hardening), `@pinout/cli` (daemon/safety/lease/record/replay/discover/verify commands), `@pinout/mcp` (metadata/license), root tooling/CI.

## 6. Protocols implemented

Modbus TCP+RTU (zero-dep, CRC verified against independent implementation), SCPI (parser/client/4 instrument classes), GRBL v1.x (status/home/moves/holds), MQTT 3.1.1 (zero-dep client + mapping). Firmata, OPC UA, MAVLink: PLANNED (truthful).

## 7. Embedded families

Data-driven descriptors for ESP32 (classic, IMPLEMENTED), ESP32-S3, ESP32-C3, RP2040 Pico, Arduino Uno — with reserved-pin validation that rejects overlapping pins. S3/C3/Pico descriptors are EXPERIMENTAL; no matching firmware builds were verified. MicroPython/CircuitPython bridge (EXPERIMENTAL, host-validated).

## 8–10. Robotics / industrial / lab

Robotics: canonical arm semantics + GRBL adapter. Industrial: Modbus register-map devices (writes explicit-only), MQTT mapping (topic→state/event, capability→publish). Lab: SCPI PowerSupply/DMM/FunctionGenerator (+conservative oscilloscope).
Simulated/fixture-tested only. No hardware verification anywhere: no physical equipment was touched.

## 11. Simulation systems

18+ first-party simulated devices (arm, chamber, motors, sensors, GRBL machine, MQTT broker, Modbus slave), deterministic, used by every test level.

## 12. Daemon/API

`pinoutd`: loopback-only, bearer-token optional, refuses non-loopback binding without explicit opt-in + token; /v1 routes for devices, invoke (idempotency, dry-run), operations, leases, halt/estop/estop-clear, SSE events, streams, journal. 15+ integration tests.

## 13. SDKs

TypeScript (core runtime API). Python client: sync stdlib-only + asyncio (httpx extra), typed errors, 11 tests. Python module SDK: `PinoutModule`/`DeviceBackend`/runner, 7 pytest + 6 cross-language host tests.

## 14. Agent interfaces

MCP adapter; protocol-neutral `runtimeToToolDefinitions()` with derived danger classification (46 tools in the demo runtime: 17 READ_ONLY / 28 PHYSICAL_SIDE_EFFECT / 1 HIGH_RISK).

## 15–17. Generator + corpus + actual numbers

Reality-check pipeline: PDF ingestion with page provenance (`PDF_TEXT_UNAVAILABLE` honesty), provenance classification (DOCUMENTED/INFERRED/UNKNOWN/CONFLICTED), contradiction engine (manual-vs-example conflicts suppress hard policies), prompt-injection scanning, bounded compile-repair (frozen safety evidence), honest implementation states.
**Measured** (fixtures/eval + ground truth, 7 targets incl. held-out): capability P/R/F1 = 1.00, semantic mapping precision 1.00, safety recall 1.00, contradiction detection 1/1 on the ambiguous corpus, false certainty 0, **fabricated hard safety constraints 0** (target 0), generation time ~20ms total. Limitation stated plainly: corpus authored in-repo; extractor was tuned against 6 targets and validated on 1 held-out target.

## 18. Safety architecture

Ordering per invocation: halt gate → legacy policies → safety engine v2 (rate/interlock/sequence/approval/lease/deadman/resource) → backend. Deployment policies only tighten module baselines; conflicts go to human review. Estop is sticky (clear → still halted → explicit resume). Software halt is documented as NOT a certified e-stop.

## 19. Security architecture

Module isolation is process-level only (declared permissions are advisory — documented, not faked). Idempotency hardened after adversarial review: bounded LRU store (max entries + retention window), owner-scoped keys, documented post-eviction re-execution semantics. Journal redacts credential-shaped keys and truncates oversized payloads. Daemon refuses unsecured remote exposure.

## 20. Standards research

Time-boxed review of current agent-facing interface practice: MCP remains the only implementable agent↔tool standard with meaningful adoption; no competing AI↔hardware standard with a public implementable spec was found. Pinout's design already treats MCP as an adapter (`runtimeToToolDefinitions` is vendor-neutral). Nothing was redesigned around a vendor standard.

## 21. CLI

devices, ports, invoke, hello, gpio.*, runtime.*, module (create/test/install/list/inspect/integrity/verify), device.*, generate, daemon status, halt/resume/estop/estop-clear, lease acquire/list/release, operations, logs, record start/stop, replay, discover, doctor, pins. `--json` everywhere relevant.

## 22. Tests

545 tests / 69 files: unit, integration (daemon HTTP, cross-language module host), chaos/fault-injection, deterministic fuzz (fixed: policy null-state crash, MQTT OOB reads, idempotency unbounded growth), schema conformance, generator evaluation, board descriptor validation, frame/unit confusion. Python: 18 tests across both SDKs. MicroPython bridge: 10 protocol checks.

## 23. Benchmarks (this machine, Node v26)

policy.evaluate 40 ns/op · journal.append 0.51 µs/op · idempotency record+lookup 0.44 µs/op · stream.publish 0.32 µs/op · runtime.invoke round-trip 2.0 µs/op · operation lifecycle 3.0 µs/op. Recorded via `npm run bench` to benchmarks/results/ (gitignored). Not marketing claims.

## 24. CI

OS × Node matrix (Ubuntu/macOS/Windows × 20/22), Python SDK job (3.10/3.12), MicroPython bridge validation, ESP32 compile job. Not exercised on remote runners — nothing was pushed.

## 25. Documentation

docs/spec/{overview,device,capabilities,operations,leases,safety,errors,journal}.md, docs/daemon.md, README (honest support catalog), module-host README (exact sandbox boundary), benchmark/reality-check provenance, baseline + ledger.

## 26–27. Hardware verification / simulated-only

**Nothing is HARDWARE_VERIFIED.** Implemented/simulated entries: ESP32 bridge, Modbus, SCPI, GRBL, MQTT, daemon, module host, discovery, generator. The support matrix in `hardware/catalog.json` never blurs statuses.

## 28. Known bugs

None open. Fuzzing-era bugs fixed in-run (see §22).

## 29. Known architectural debt

1. Capability descriptors of the 18 first-party modules predate the rich spec metadata (danger/units) — the spec layer and the module layer need a migration pass.
2. `events` lack per-device sequence numbers (journal has them).
3. Daemon auth is a single shared bearer token; no scoped capabilities/tokens yet.
4. Resolved during integration: the GRBL simulator is now exported by its package, and the demo uses the built public export.

## 30. Attempted but not completed

ROS 2 bridge design (sidecar contract) — no runtime available. OPC UA browse/read/subscribe — stack size vs. window. The previously unfinished WebSocket binary stream endpoint was completed during merge preparation; see the validation report above.

## 31. Deliberately NOT implemented

Marketing website, SaaS, billing, humanoid hardware, fake vendor modules, CANopen without correct validation, Rust client, auto-flashing firmware, BLE stubs with fake confidence, certified-e-stop claims.

## 32. Recommended next priorities

1. Migrate module descriptors to spec v1 metadata (danger/units) and wire policy provenance through the daemon.
2. Extend data-plane clients around the now-implemented WebSocket frame endpoint.
3. Universal Robots RTDE client against the documented interface + a simulator.
4. Persisted idempotency tombstones (journal-backed) for restart-safe dedupe.
5. `pinout device inspect-candidate` enrollment flow completing discovery.

## 33. Exact reproduction commands

```
git clone https://github.com/pinoutlabs/pinout && cd pinout
git checkout feat/pinout-platform-v1
npm install && npm test          # 545 tests
npm run demo:physical-intelligence
npm run demo:generate-device
npm run bench
npm run pinout -- discover --json
```

Python: `pip install -e sdk/python[dev] && pytest sdk/python/tests`
Module SDK: `pip install -e sdk/python-module[dev] && pytest sdk/python-module/tests`

## 34. Commit list

58 commits from `1333df4` (hygiene) through `9b91594` (packaging), conventional-commit history on `feat/pinout-platform-v1`; full list via `git log --oneline ed61401..HEAD`.

## 35. PR URL

None. **Nothing was pushed and no PR was opened**, per instructions. To publish when authorized:

```
git push -u origin feat/pinout-platform-v1
```
