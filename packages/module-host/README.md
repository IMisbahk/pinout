# @pinout/module-host

Out-of-process module hosting for Pinout. External modules are executable
code; this package treats them as untrusted by running each one in a child
process speaking a strict NDJSON protocol (`ModuleIPC`).

## What this actually guarantees

- **Crash isolation** — a worker that segfaults, exits, or hangs mid-invoke
  rejects only the pending invocation. `pinoutd` and other modules keep
  running. Structured errors: `MODULE_CRASHED` (retryable), `MODULE_DEAD`.
- **Heartbeat watchdog** — workers heartbeat ~1/s; silence beyond
  3×interval+500ms is treated exactly like a crash.
- **Bounded restarts** — exponential backoff, `maxRestarts` (default 3);
  past the budget the process is `dead` and invocations fail fast.
- **Request correlation** — invoke ids correlate strictly; out-of-order or
  duplicate worker responses cannot corrupt other calls.
- **Graceful shutdown** — shutdown message → 2s grace → SIGTERM → SIGKILL.

## What this does NOT guarantee (read this)

**This is not a security sandbox.** A malicious worker process can access the
operating system with its own privileges: read files, open network
connections, spawn subprocesses. The `permissions` block in
`pinout.module.json` (network, serial, USB, filesystem, environment,
subprocess, bluetooth) is *declared review metadata* surfaced by
`auditPermissions()` so installers and reviewers can make informed decisions
— it is **not enforcement**, and Node.js cannot reliably provide OS-level
sandboxing for arbitrary code. Treat module installation as code review.

## Usage

```ts
import { ModuleHost } from '@pinout/module-host';

const host = new ModuleHost();
const handle = host.spawn({
  id: 'my-device',
  runtime: 'node',            // or 'python' (requires `pinout-module` SDK)
  modulePath: './my-module/index.js',
  config: { port: '/dev/ttyUSB0' },
});
await handle.start();
const result = await handle.invoke('temperature.read', {});
```

Python modules use the `pinout-module` SDK (`sdk/python-module`): subclass
`PinoutModule`, and the host spawns `python3 -m pinout_module <file>`.
