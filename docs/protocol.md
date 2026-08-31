# Pinout protocol v1

Host and device exchange **newline-delimited JSON** (NDJSON) over a byte transport. The first implementation uses USB serial at **115200 8N1**, no hardware flow control.

The protocol is not ESP32-specific. ESP32 is the first device that speaks it.

## Framing

- UTF-8
- One JSON object per line
- Lines end with `\n` (`\r\n` is accepted)
- Lines that do not start with `{` are ignored (ESP32 ROM boot logs, debug prints)
- Maximum request line: 512 bytes on the ESP32 bridge (`maxProtocolLineBytes` in the SDK)

## Request (host → device)

```json
{
  "v": 1,
  "id": "3f1c0a2e-7b64-4c0d-9e2a-0c0b1d2e3f40",
  "action": "gpio.write",
  "payload": { "pin": 2, "value": true }
}
```

| Field | Rule |
| --- | --- |
| `v` | Protocol version. Currently `1`. |
| `id` | Non-empty string. Unique among in-flight requests. Echoed in the response. |
| `action` | Dotted name: `family.operation`. |
| `payload` | Object. Use `{}` when the action has no input. |

## Success response (device → host)

```json
{
  "v": 1,
  "id": "3f1c0a2e-7b64-4c0d-9e2a-0c0b1d2e3f40",
  "ok": true,
  "result": { "pin": 2, "value": true }
}
```

## Error response (device → host)

```json
{
  "v": 1,
  "id": "3f1c0a2e-7b64-4c0d-9e2a-0c0b1d2e3f40",
  "ok": false,
  "error": {
    "code": "INVALID_PIN",
    "message": "GPIO 34 is input-only on ESP32 and cannot be driven."
  }
}
```

## Event (device → host, unsolicited)

Events have `event` and no `id`.

```json
{
  "v": 1,
  "event": "ready",
  "payload": {
    "firmware": "esp32-bridge",
    "version": "0.1.0",
    "protocol": 1,
    "capabilities": ["sys.hello", "gpio.mode", "gpio.write", "gpio.read", "gpio.toggle", "gpio.pulse", "gpio.pwm", "gpio.analogRead", "gpio.watch", "gpio.unwatch"]
  }
}
```

The ESP32 bridge emits `ready` after `Serial.begin`. Opening a USB serial port often resets the chip, so the host must wait for this event (or time out) instead of sending commands immediately.

## Actions

### `sys.hello`

Payload: `{}`

Result: same identity object as the `ready` event payload.

### `gpio.write`

Payload:

```json
{ "pin": 2, "value": true }
```

`value` is a JSON boolean. The ESP32 bridge sets the pin to `OUTPUT` and drives it.

Result: `{ "pin": 2, "value": true }`

### `gpio.read`

Payload: `{ "pin": 2 }`

Result: `{ "pin": 2, "value": false }`

On the simulator, unread pins are low and reads respect the configured pin mode (`pullup` defaults high, `pulldown` defaults low). On hardware, the level is whatever `digitalRead` returns for the current pin mode.

### `gpio.mode`

Payload:

```json
{ "pin": 4, "mode": "pullup" }
```

`mode` is one of `input`, `output`, `pullup`, or `pulldown`. Output mode requires a writable pin; input modes require a readable pin. GPIO 12 (boot strap) is refused.

Result: `{ "pin": 4, "mode": "pullup" }`

### `gpio.toggle`

Payload: `{ "pin": 2 }`

Toggles a pin that is already in `output` mode.

Result: `{ "pin": 2, "value": true }`

### `gpio.pulse`

Payload:

```json
{ "pin": 2, "value": true, "durationMs": 100 }
```

Drives the pin to `value` for `durationMs` milliseconds, then restores the previous level. On firmware the request blocks until the pulse completes; the simulator schedules the revert asynchronously.

Result: `{ "pin": 2, "value": true, "durationMs": 100, "previousValue": false }`

### `gpio.pwm`

Payload:

```json
{ "pin": 2, "duty": 0.5, "frequency": 5000, "channel": 0 }
```

`duty` is `0`–`1`. `frequency` defaults to `5000` Hz. `channel` defaults to `pin % 8` (0–15). Setting `duty` to `0` stops output on that channel.

Result: `{ "pin": 2, "duty": 0.5, "frequency": 5000, "channel": 0 }`

### `gpio.analogRead`

Payload: `{ "pin": 32 }`

Reads a 12-bit ADC sample on ESP32 GPIO 32–39 only.

Result: `{ "pin": 32, "value": 2048 }`

### `gpio.watch` / `gpio.unwatch`

Payload: `{ "pin": 2 }`

Subscribe or unsubscribe from change notifications for a readable pin.

Result: `{ "pin": 2, "watching": true }` or `{ "pin": 2, "watching": false }`

### `gpio.changed` (event)

Unsolicited event emitted when a watched pin changes level:

```json
{
  "v": 1,
  "event": "gpio.changed",
  "payload": { "pin": 2, "value": true }
}
```

Firmware polls watched pins in `loop()`. The simulator emits this event when a watched pin is written, toggled, pulsed, or reverted after a pulse.

## Error codes

| Code | Meaning |
| --- | --- |
| `INVALID_JSON` | Line started with `{` but was not valid JSON. |
| `INVALID_MESSAGE` | JSON parsed but is not a valid request (wrong version, missing fields, line too long). |
| `UNKNOWN_ACTION` | Action is not implemented on this device. |
| `INVALID_PIN` | Pin is out of range or forbidden on this device. |
| `INVALID_PAYLOAD` | Action input failed validation. |

Host-only errors (never sent by the device): `TIMEOUT`, `TRANSPORT_ERROR`, `PROTOCOL_ERROR`, `DISCONNECTED`, `UNSUPPORTED_CAPABILITY`, `VALIDATION_ERROR`.

The simulator uses the same device error codes as firmware. There is no `INTERNAL` code.

## Extending the protocol

Add a new action name and document its payload. Do not invent a second framing format for the next sensor.

Keep `v: 1` until a breaking change is required. Additional fields on existing objects should be ignored by older hosts and devices.

A later binary transport can still carry these JSON objects, or introduce `v: 2` with a length-prefixed envelope. The host `Transport` interface is byte-oriented so that change does not rewrite the SDK.
