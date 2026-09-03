# Platform integration validation

Validated on 2026-09-03 before merging `feat/pinout-platform-v1` into `main`.
The feature branch started this review at `698bcdc`; `main` was `cb69a93`.
All other local feature branches were already ancestors of the platform branch.
The existing uncommitted cleanup was preserved and included in the integration.

## Fixes and completed work

- MQTT CONNECT now places credentials in the correct payload order, sets flags,
  respects clean-session configuration, and encodes keepalive and packet IDs as
  full 16-bit values. The client rejects connection/subscription refusals,
  keeps handlers per subscription, propagates write failures, sends keepalive
  pings, and closes timed-out sessions. Buffering is bounded. Regression vectors
  are independent of the broker simulator's codec.
- GRBL requests are serialized, parser queries consume their trailing `ok`, and
  each move sends one newline with explicit millimeters, absolute coordinates,
  and feed-per-minute mode. Alarms and disconnects surface as errors. A timed-out
  session is closed so a late acknowledgement cannot acknowledge another move.
  The simulator is now a public package export used by the built demo.
- Daemon invocations preserve caller identity for idempotency and device policy
  checks. Structured validation errors produce HTTP 400. Dry runs check both
  device and daemon policies without consuming approvals, rate slots, or budgets.
  Rejected safety checks roll back those consumables; retries return their
  original operation even after an approval is spent or a halt is engaged.
- Idempotency keys use unambiguous tuple encoding. Operation timeouts remain
  terminal when a backend later resolves or rejects.
- Completed `/v1/streams/:id/frames`: authenticated, read-only WebSocket delivery
  of raw binary and JSON frames with bounded buffering, size limits, stalled-send
  handling, and shutdown cleanup. Stream subscriptions release end callbacks.
- Board validation rejects malformed pin arrays and unsupported status labels.
  S3/C3/Pico data descriptors are marked EXPERIMENTAL: no matching firmware
  compile verification was available.
- Fixed lint errors, Python module SDK packaging/readme/development dependencies,
  and CI coverage of the Python module SDK. Compiler integration tests have a
  30-second timeout because they spawn actual compiler processes.
- Updated Vitest and its coverage provider to 3.2.7 and refreshed the lockfile;
  the resulting dependency audit reports zero vulnerabilities.

## Verification

| Check | Result |
| --- | --- |
| Full TypeScript test suite, Node 22.23.2 / Vitest 3.2.7 | 571 tests, 71 files passed |
| `npm run lint` | Passed |
| `npx tsc -b --force` | Passed, all project outputs rebuilt |
| `npm run format:check` | Passed |
| `git diff --check` | Passed |
| `npm audit --audit-level=moderate` | Zero vulnerabilities |
| Python client + module SDK pytest suites | 18 passed |
| Both Python SDK wheel and source-distribution builds | Passed |
| MicroPython host-side bridge protocol validation | 10/10 checks passed |
| `demo:physical-intelligence`, `demo:generate-device` | Passed using simulators/fixtures |
| `npm run bench` | Completed; local measurements in ignored `benchmarks/results/` |

Python verification used an isolated virtual environment. No physical devices
were connected or actuated. ESP32 firmware compilation/flashing and the remote
OS/Node CI matrix were not run. MQTT was checked with independent wire vectors
and the local simulator, not a production broker.

ROS 2, OPC UA, persistent restart-safe idempotency, and scoped authentication
remain explicitly deferred architectural work. They are not represented as
implemented by this merge.

## Protocol references

- [OASIS MQTT 3.1.1](https://docs.oasis-open.org/mqtt/mqtt/v3.1.1/os/mqtt-v3.1.1-os.html)
- [GRBL v1.1 interface](https://github.com/gnea/grbl/wiki/Grbl-v1.1-Interface)
- [Vitest migration guide](https://vitest.dev/guide/migration.html)
