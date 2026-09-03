# Roadmap

This is a direction, not a promise or a release schedule. Items move only when implementation, tests, and documentation support them.

## Now: make the reference control plane trustworthy

- Stabilize capability, module, runtime, and policy contracts.
- Keep the ESP32 serial path and protocol v1 reproducible.
- Improve simulator parity and make real-vs-simulated provenance obvious.
- Expand conformance, failure-mode, and policy tests.
- Make generated modules easier to inspect, diff, and reject safely.

## Next: integration surface

- Additional transport adapters (BLE and CAN are currently deferred).
- Explicit event/state observation and structured invocation records.
- Better module lifecycle, compatibility metadata, and upgrade/rollback behavior.
- Hardware-in-the-loop examples for selected reference devices, with measurements and setup documented when they exist.

## Later: production and industrial path

- Deployment profiles for isolated runtimes, credentials, network segmentation, and operator controls.
- Durable audit export and policy administration suitable for enterprise review.
- Fleet identity, health, and rollout workflows only after their threat model and operational contracts are specified.
- Certified or regulated use only with external safety engineering and applicable assessments; no certification is claimed today.

## Explicit non-goals for this repository

Private vendor control-plane emulation, autonomous safety guarantees, silent cloud dependence, a universal device catalog, and claims of production readiness without deployment evidence.
