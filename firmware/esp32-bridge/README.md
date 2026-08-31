# ESP32 bridge firmware

Minimal firmware that speaks Pinout protocol v1 over USB serial (UART0 at 115200 8N1).

It does not implement a full board support package. It accepts structured commands, validates them, executes GPIO read/write, and returns JSON responses.

## What it supports

- `sys.hello`, `sys.ping`, `sys.info`
- `gpio.mode`, `gpio.write`, `gpio.read`, `gpio.toggle`, `gpio.pulse`
- `gpio.pwm`, `gpio.analogRead`, `gpio.watch`, `gpio.unwatch` (`gpio.changed` events)

See [docs/protocol.md](../../docs/protocol.md) for the message format.

## Hardware

Tested against classic ESP32 DevKit boards (WROOM / 30-pin). The onboard LED is usually **GPIO 2**.

Do not use:

- GPIO 6–11 (SPI flash)
- GPIO 1 and 3 (USB serial)
- GPIO 12 (boot strap; held high at reset can prevent boot)
- GPIO 34–39 as outputs (input-only)

## Flash with PlatformIO

```bash
cd firmware/esp32-bridge
pio run -t upload
pio device monitor
```

You should see a JSON `ready` event after reset, possibly mixed with ROM boot log lines. The host SDK ignores non-JSON lines.

## Flash with Arduino IDE

1. Install the ESP32 board package.
2. Install **ArduinoJson** 7 from Library Manager.
3. Open `src/main.cpp` (or copy it into a `.ino` sketch).
4. Board: **ESP32 Dev Module**, baud **115200**.
5. Upload.

## Run from Pinout

```bash
npm run pinout -- devices
npm run pinout -- hello --port /dev/cu.usbserial-10
npm run pinout -- gpio write 2 high --port /dev/cu.usbserial-10
npm run pinout -- gpio write 2 low --port /dev/cu.usbserial-10
```

On Linux the port is often `/dev/ttyUSB0` or `/dev/ttyACM0`. On macOS use `/dev/cu.*`, not `/dev/tty.*`.
