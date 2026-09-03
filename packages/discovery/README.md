# @pinout/discovery

Device discovery for Pinout. Answers "what might be out there?" with
evidence and honest confidence — and **never actuates hardware**.

## The never-actuate rule

- The `DiscoveryPlugin` interface has **no write path**.
- Serial ports are enumerated, never opened (some adapters reset their target
  on open).
- USB devices are enumerated via OS metadata (VID/PID), never claimed.
- mDNS sends one bounded query packet and listens.
- Network probing is **opt-in** (`--network --probe host:port`), bounded to
  explicitly supplied endpoints, and sends only a read-only `GET /v1/health`.
  There is no subnet scanning — deliberately.

## Honesty rules (enforced by `validateCandidate`)

- Confidence is capped at **0.95**; only a device-confirmed handshake (a
  health check that answered `{ok:true}`) justifies ≥ 0.9.
- A single weak heuristic (manufacturer string, VID/PID, open port) caps at
  **0.5**. A device identity is never claimed on one weak signal.
- Every candidate must carry evidence; candidates without evidence are
  rejected, not silently shipped.

## Plugins

| Plugin | Platform | Notes |
| --- | --- | --- |
| `serial` | all | manufacturer-string matching against a small table |
| `usb` | macOS (`system_profiler`), Linux (`/sys/bus/usb`) | Windows returns empty rather than guessing |
| `mdns` | all (multicast permitting) | zero-dependency DNS-SD query + minimal response parse |
| `network-probe` | all | opt-in; explicit endpoints only |

BLE discovery is **not implemented** — no stub results, no fake confidence.

## Output

```
FOUND 2 CANDIDATE DEVICES

/dev/cu.usbserial-1420
  possible: Espressif pinout/esp32
  confidence: 0.50
  evidence: usb-manufacturer — /dev/cu.usbserial-1420: manufacturer 'Silicon Labs'
  interfaces: serial
```
