# pinoutd — the local execution daemon

`pinoutd` (`packages/daemon`) is the local physical execution service. It
hosts the runtime, devices, and module backends; enforces leases, policies,
and the halt coordinator; manages long-running operations; journals activity;
and exposes a local HTTP API.

## Running

```bash
# From the repo root (demo devices for exploration):
node packages/daemon/dist/main.js --demo

# Options:
#   --port 8787        TCP port (default 8787)
#   --host 127.0.0.1   bind host — loopback ONLY unless remote access is
#                      explicitly enabled (see below)
#   --token <t>        require a bearer token on all /v1 routes except health
#   --journal <path>   persist the control journal to a JSONL file
```

## Security model

- **Loopback by default.** The daemon refuses to bind a non-loopback host
  unless `allowRemote` is set **and** a token is configured. There is no
  configuration that exposes physical control to a network unauthenticated.
- **Bearer auth** when a token is set; `GET /v1/health` stays open for
  readiness probes.
- Secrets belong in environment variables or OS keychains — never in
  `devices.yaml`, never in source control.

## API (v1)

| Route | Purpose |
| --- | --- |
| `GET /v1/health` | Readiness, safety state, device count |
| `GET /v1/devices` | Device summaries |
| `GET /v1/devices/:id` | Device detail: capabilities + operational state |
| `GET /v1/devices/:id/state` | Operational state + health |
| `POST /v1/devices/:id/invoke` | Invoke a capability (see below) |
| `GET /v1/operations`, `GET /v1/operations/:id` | Operation inspection |
| `POST /v1/operations/:id/cancel` | Cooperative cancellation |
| `GET/POST /v1/leases`, `POST /v1/leases/:id/renew`, `DELETE /v1/leases/:id` | Lease management |
| `GET /v1/safety`, `POST /v1/halt`, `POST /v1/resume`, `POST /v1/estop`, `POST /v1/estop/clear` | Safety state |
| `GET /v1/events` | Server-Sent Events stream of runtime/operation/safety events |
| `GET /v1/streams`, `GET /v1/streams/:id/snapshot` | Stream metadata and latest-frame snapshots |
| `GET /v1/journal` | Journal inspection |

### Invocation

```jsonc
POST /v1/devices/relay-01/invoke
{
  "capability": "relay.set",
  "args": { "on": true },
  "waitFor": "result",        // or omitted → 202 with an operation handle
  "idempotencyKey": "retry-42",
  "owner": "agent-a",         // lease owner for lease-gated capabilities
  "timeoutMs": 30000,
  "dryRun": false
}
```

`dryRun: true` returns the resolved arguments and policy verdict **without
executing** — allowed even while halted (planning is safe, execution is not).

## Not a safety system

`POST /v1/estop` coordinates the runtime's software response. It is not a
certified emergency-stop system and does not replace hardware safeguards.
