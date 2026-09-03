# Pinout MicroPython Bridge

A single, conservative bridge that makes **many** MicroPython and
CircuitPython boards speak the Pinout NDJSON wire protocol (v1) — no bespoke
firmware per board.

## Status: EXPERIMENTAL

Protocol behavior is host-validated (`node validate.js`, runs the bridge in
software mode under `python3`). Hardware behavior is **not verified**; treat
this as a starting point, not a supported target.

## Install

1. Copy `main.py` and `config.py` to the board's filesystem
   (`mpremote cp main.py :/`, Thonny, `ampy`, …).
2. Edit `config.py` for your board: UART pins, I2C/SPI defaults, and
   `RESERVED_PINS` (flash/strap pins you never want driven).
3. Reset the board. It now speaks Pinout over UART at 115200.

## Capability detection

`machine.*` imports are guarded: on boot the bridge detects what the runtime
provides and reports failures (`ACTION_FAILED`) for peripherals that are not
available, rather than fabricating values. Pin state is always mirrored in
software, so `gpio.read`/`gpio.toggle` behave consistently; on hardware the
physical pin is driven too.

Software-only mode (no `machine` module — e.g. a laptop) runs the same
protocol over stdin/stdout. That is what `validate.js` exercises.

## Wire protocol

Identical to the ESP32 bridge (`firmware/esp32-bridge`) and
`packages/core/src/protocol.ts`:

```
→ {"v":1,"id":"1","action":"gpio.write","payload":{"pin":2,"value":1}}
← {"v":1,"id":"1","ok":true,"result":{"pin":2,"value":1}}
← {"v":1,"id":"2","ok":false,"error":{"code":"ACTION_FAILED","message":"..."}}
```

## Boards

Any board with the `machine` module should work for GPIO/PWM/ADC/I2C/SPI,
subject to its own pin capabilities. Because the bridge never assumes a pin
map it was not given, board-specific knowledge stays in `config.py` and in
Pinout's data-driven board descriptors (see `board-descriptor.json`).
