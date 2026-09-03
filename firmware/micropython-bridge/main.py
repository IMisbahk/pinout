"""Pinout bridge for MicroPython / CircuitPython boards.

Speaks the Pinout NDJSON wire protocol (v1) over a UART (on hardware) or
stdin/stdout (for host-side validation and simulation). One JSON object per
line:

  request  {"v":1,"id":"1","action":"gpio.write","payload":{"pin":2,"value":1}}
  response {"v":1,"id":"1","ok":true,"result":{...}}
           {"v":1,"id":"1","ok":false,"error":{"code":"...","message":"..."}}

Capability detection is runtime and conservative: hardware actions that the
board (or the host) cannot support return a protocol failure instead of
guessing. Pin state is always tracked in software so gpio.read/toggle work
everywhere; on hardware the physical pin is driven as well.

Support status: EXPERIMENTAL — not hardware-verified.
"""

import json
import sys

try:
    import config as cfg
except ImportError:  # pragma: no cover - config always ships with the bridge
    cfg = None

PROTOCOL_VERSION = 1
FIRMWARE_NAME = "micropython-bridge"
FIRMWARE_VERSION = "0.1.0"
LINE_MAX = 512

CAPABILITIES = [
    "sys.ping",
    "sys.info",
    "gpio.mode",
    "gpio.read",
    "gpio.write",
    "gpio.toggle",
    "gpio.watch",
    "adc.read",
    "pwm.configure",
    "pwm.write",
    "i2c.scan",
    "i2c.read",
    "i2c.write",
    "spi.transfer",
]

# ---------------------------------------------------------------------------
# Hardware detection: `machine` exists on MicroPython boards. On a laptop the
# bridge runs in software-only mode (used by validate.js).
# ---------------------------------------------------------------------------

try:
    import machine  # type: ignore

    HARDWARE = True
except ImportError:
    machine = None
    HARDWARE = False

if cfg is None:  # minimal fallbacks so the bridge never crashes without config
    RESERVED_PINS = frozenset()
    MAX_WATCHES = 8
    UART_ID = 0
    UART_BAUD = 115200
    I2C_SCL_PIN = 9
    I2C_SDA_PIN = 8
    I2C_FREQUENCY = 100000
    SPI_SCK_PIN = 6
    SPI_MOSI_PIN = 7
    SPI_MISO_PIN = 4
    SPI_FREQUENCY = 1000000
else:
    RESERVED_PINS = getattr(cfg, "RESERVED_PINS", frozenset())
    MAX_WATCHES = getattr(cfg, "MAX_WATCHES", 8)
    UART_ID = getattr(cfg, "UART_ID", 0)
    UART_BAUD = getattr(cfg, "UART_BAUD", 115200)
    I2C_SCL_PIN = getattr(cfg, "I2C_SCL_PIN", 9)
    I2C_SDA_PIN = getattr(cfg, "I2C_SDA_PIN", 8)
    I2C_FREQUENCY = getattr(cfg, "I2C_FREQUENCY", 100000)
    SPI_SCK_PIN = getattr(cfg, "SPI_SCK_PIN", 6)
    SPI_MOSI_PIN = getattr(cfg, "SPI_MOSI_PIN", 7)
    SPI_MISO_PIN = getattr(cfg, "SPI_MISO_PIN", 4)
    SPI_FREQUENCY = getattr(cfg, "SPI_FREQUENCY", 1000000)


class Bridge:
    def __init__(self):
        self.pin_modes = {}      # pin -> "input" | "output"
        self.pin_values = {}     # pin -> 0 | 1 (software shadow of every pin)
        self.hardware_pins = {}  # pin -> machine.Pin when hardware-backed
        self.watches = {}        # pin -> last observed value
        self.adc_channels = {}   # pin -> machine.ADC
        self.pwm = {}            # pin -> {"pwm": machine.PWM, "duty": int} or software
        self.i2c = None
        self.spi = None
        self.boot_ticks = 0

    # -- helpers -------------------------------------------------------------

    def _check_pin(self, pin):
        if not isinstance(pin, int) or isinstance(pin, bool) or pin < 0:
            raise ValueError("pin must be a non-negative integer")
        if pin in RESERVED_PINS:
            raise ValueError("pin %d is reserved" % pin)

    def _hardware_pin(self, pin, mode):
        """Return a machine.Pin for `pin` or None in software-only mode."""
        if not HARDWARE:
            return None
        key = (pin, mode)
        cached = self.hardware_pins.get(key)
        if cached is not None:
            return cached
        pin_mode = machine.Pin.OUT if mode == "output" else machine.Pin.IN
        hw = machine.Pin(pin, pin_mode)
        self.hardware_pins[key] = hw
        return hw

    # -- sys actions ----------------------------------------------------------

    def sys_hello(self, payload):
        info = self.sys_info({})
        return {
            "firmware": FIRMWARE_NAME,
            "version": FIRMWARE_VERSION,
            "protocol": PROTOCOL_VERSION,
            "capabilities": list(CAPABILITIES),
            "hardware": HARDWARE,
            "board": info.get("board", "unknown"),
        }

    def sys_ping(self, payload):
        return {"pong": True}

    def sys_info(self, payload):
        board = "host"
        machine_name = "none"
        if HARDWARE:
            try:
                uname = machine.info() if hasattr(machine, "info") else None
            except Exception:
                uname = None
            try:
                import os

                uname = os.uname()
                machine_name = uname.machine
                board = uname.sysname
            except Exception:
                machine_name = "micropython"
                board = "unknown"
        return {
            "firmware": FIRMWARE_NAME,
            "version": FIRMWARE_VERSION,
            "protocol": PROTOCOL_VERSION,
            "hardware": HARDWARE,
            "board": board,
            "machine": machine_name,
            "capabilities": list(CAPABILITIES),
        }

    # -- gpio actions ----------------------------------------------------------

    def gpio_mode(self, payload):
        pin = payload.get("pin")
        mode = payload.get("mode")
        self._check_pin(pin)
        if mode not in ("input", "input-pullup", "input-pulldown", "output"):
            raise ValueError("mode must be input, input-pullup, input-pulldown or output")
        self.pin_modes[pin] = mode
        if HARDWARE and mode.startswith("input"):
            pulls = {
                "input": machine.Pin.PULL_NONE,
                "input-pullup": machine.Pin.PULL_UP,
                "input-pulldown": machine.Pin.PULL_DOWN,
            }
            self.hardware_pins[(pin, "input")] = machine.Pin(pin, machine.Pin.IN, pulls[mode])
        return {"pin": pin, "mode": mode}

    def gpio_read(self, payload):
        pin = payload.get("pin")
        self._check_pin(pin)
        mode = self.pin_modes.get(pin)
        if HARDWARE and (mode or "").startswith("input"):
            hw = self._hardware_pin(pin, "input")
            if hw is not None:
                value = 1 if hw.value() else 0
                self.pin_values[pin] = value
                return {"pin": pin, "value": value}
        if pin not in self.pin_values:
            raise ValueError("pin %d has no known value; call gpio.write or gpio.mode first" % pin)
        return {"pin": pin, "value": self.pin_values[pin]}

    def gpio_write(self, payload):
        pin = payload.get("pin")
        value = payload.get("value")
        self._check_pin(pin)
        if value not in (0, 1, True, False):
            raise ValueError("value must be 0 or 1")
        mode = self.pin_modes.get(pin)
        if mode is not None and mode != "output":
            raise ValueError("pin %d is configured as %s; call gpio.mode first" % (pin, mode))
        self.pin_modes[pin] = "output"
        self.pin_values[pin] = 1 if value in (1, True) else 0
        hw = self._hardware_pin(pin, "output")
        if hw is not None:
            hw.value(self.pin_values[pin])
        return {"pin": pin, "value": self.pin_values[pin]}

    def gpio_toggle(self, payload):
        pin = payload.get("pin")
        self._check_pin(pin)
        if pin not in self.pin_values:
            raise ValueError("pin %d has no known value; call gpio.write first" % pin)
        return self.gpio_write({"pin": pin, "value": 0 if self.pin_values[pin] else 1})

    def gpio_watch(self, payload):
        pin = payload.get("pin")
        self._check_pin(pin)
        enable = payload.get("enable", True)
        if enable:
            if pin not in self.watches and len(self.watches) >= MAX_WATCHES:
                raise ValueError("watch table full")
            self.watches[pin] = self.pin_values.get(pin, 0)
            return {"pin": pin, "watching": True}
        self.watches.pop(pin, None)
        return {"pin": pin, "watching": False}

    # -- adc / pwm ---------------------------------------------------------------

    def adc_read(self, payload):
        pin = payload.get("pin")
        self._check_pin(pin)
        if not HARDWARE:
            raise ValueError("adc.read requires hardware (no machine module on this host)")
        adc = self.adc_channels.get(pin)
        if adc is None:
            adc = machine.ADC(machine.Pin(pin))
            self.adc_channels[pin] = adc
        if hasattr(adc, "read_u16"):
            raw = adc.read_u16()
            scale = 65535
        else:
            raw = adc.read()
            scale = 4095
        return {"pin": pin, "raw": raw, "scale": scale}

    def pwm_configure(self, payload):
        pin = payload.get("pin")
        frequency = payload.get("frequency", 1000)
        self._check_pin(pin)
        if not isinstance(frequency, int) or frequency < 1 or frequency > 100000:
            raise ValueError("frequency must be an integer in [1, 100000]")
        if HARDWARE:
            hw = self._hardware_pin(pin, "output")
            self.pwm[pin] = {"pwm": machine.PWM(hw), "frequency": frequency, "duty": 0}
            self.pwm[pin]["pwm"].freq(frequency)
        else:
            self.pwm[pin] = {"pwm": None, "frequency": frequency, "duty": 0}
        return {"pin": pin, "frequency": frequency}

    def pwm_write(self, payload):
        pin = payload.get("pin")
        duty = payload.get("duty")
        self._check_pin(pin)
        entry = self.pwm.get(pin)
        if entry is None:
            raise ValueError("pin %d has no PWM configuration; call pwm.configure first" % pin)
        if not isinstance(duty, int) or duty < 0 or duty > 65535:
            raise ValueError("duty must be an integer in [0, 65535]")
        entry["duty"] = duty
        hw = entry.get("pwm")
        if hw is not None:
            if hasattr(hw, "duty_u16"):
                hw.duty_u16(duty)
            else:
                hw.duty(int(duty * 1023 / 65535))
        return {"pin": pin, "duty": duty}

    # -- i2c / spi -----------------------------------------------------------

    def _ensure_i2c(self):
        if self.i2c is not None:
            return self.i2c
        if not HARDWARE:
            raise ValueError("i2c requires hardware (no machine module on this host)")
        try:
            self.i2c = machine.SoftI2C(scl=machine.Pin(I2C_SCL_PIN), sda=machine.Pin(I2C_SDA_PIN), freq=I2C_FREQUENCY)
        except AttributeError:
            self.i2c = machine.I2C(I2C_SCL_PIN, I2C_SDA_PIN, freq=I2C_FREQUENCY)
        return self.i2c

    def i2c_scan(self, payload):
        bus = self._ensure_i2c()
        return {"addresses": [hex(address) for address in bus.scan()]}

    def i2c_write(self, payload):
        address = payload.get("address")
        data = payload.get("data")
        if not isinstance(address, int) or not isinstance(data, list):
            raise ValueError("address (int) and data (list) are required")
        bus = self._ensure_i2c()
        bus.writeto(address, bytes(bytearray(data)))
        return {"address": address, "written": len(data)}

    def i2c_read(self, payload):
        address = payload.get("address")
        length = payload.get("length")
        if not isinstance(address, int) or not isinstance(length, int) or length < 1 or length > 32:
            raise ValueError("address (int) and length (int in [1, 32]) are required")
        bus = self._ensure_i2c()
        data = bus.readfrom(address, length)
        return {"address": address, "data": list(data)}

    def _ensure_spi(self):
        if self.spi is not None:
            return self.spi
        if not HARDWARE:
            raise ValueError("spi requires hardware (no machine module on this host)")
        try:
            self.spi = machine.SoftSPI(
                baudrate=SPI_FREQUENCY,
                polarity=0,
                phase=0,
                sck=machine.Pin(SPI_SCK_PIN),
                mosi=machine.Pin(SPI_MOSI_PIN),
                miso=machine.Pin(SPI_MISO_PIN),
            )
        except AttributeError:
            self.spi = machine.SPI(0)
        return self.spi

    def spi_transfer(self, payload):
        data = payload.get("data")
        if not isinstance(data, list) or len(data) < 1 or len(data) > 32:
            raise ValueError("data (list of 1..32 bytes) is required")
        bus = self._ensure_spi()
        out = bytes(bytearray(data))
        received = bytearray(len(out))
        bus.write_readinto(out, received)
        return {"data": list(received)}


# ---------------------------------------------------------------------------
# Protocol plumbing
# ---------------------------------------------------------------------------

def handle_request(bridge, request):
    """Dispatch one parsed request object; returns a response object."""
    action = request.get("action", "")
    payload = request.get("payload", {})
    handler = HANDLERS.get(action)
    if handler is None:
        return _failure(request["id"], "UNSUPPORTED_ACTION", "Unknown action '%s'." % action)
    try:
        result = handler(bridge, payload)
        return {"v": PROTOCOL_VERSION, "id": request["id"], "ok": True, "result": result}
    except Exception as error:
        return _failure(request["id"], "ACTION_FAILED", str(error))


def _failure(request_id, code, message):
    return {
        "v": PROTOCOL_VERSION,
        "id": request_id,
        "ok": False,
        "error": {"code": code, "message": message},
    }


HANDLERS = {
    "sys.hello": Bridge.sys_hello,
    "sys.ping": Bridge.sys_ping,
    "sys.info": Bridge.sys_info,
    "gpio.mode": Bridge.gpio_mode,
    "gpio.read": Bridge.gpio_read,
    "gpio.write": Bridge.gpio_write,
    "gpio.toggle": Bridge.gpio_toggle,
    "gpio.watch": Bridge.gpio_watch,
    "adc.read": Bridge.adc_read,
    "pwm.configure": Bridge.pwm_configure,
    "pwm.write": Bridge.pwm_write,
    "i2c.scan": Bridge.i2c_scan,
    "i2c.read": Bridge.i2c_read,
    "i2c.write": Bridge.i2c_write,
    "spi.transfer": Bridge.spi_transfer,
}


def process_line(bridge, line, emit):
    """Parse one input line and emit zero or more response lines."""
    line = line.strip()
    if not line or not line.startswith("{"):
        return  # ignore: keepalive noise, echoes, partial lines
    try:
        request = json.loads(line)
    except ValueError:
        return  # invalid JSON from the host: drop it rather than crash the link
    if not isinstance(request, dict) or request.get("v") != PROTOCOL_VERSION:
        return  # only speak v1
    if "action" not in request or "id" not in request:
        return
    emit(json.dumps(handle_request(bridge, request)))


def run_stdio(bridge):
    """Host/simulation mode: request lines on stdin, responses on stdout."""
    def emit(text):
        sys.stdout.write(text + "\n")
        sys.stdout.flush()

    for line in sys.stdin:
        process_line(bridge, line, emit)


def run_uart(bridge):
    """Hardware mode: NDJSON over a UART."""
    uart = machine.UART(cfg.UART_ID, baudrate=cfg.UART_BAUD)
    buffer = b""

    def emit(text):
        uart.write((text + "\n").encode())

    while True:
        waiting = uart.read()
        if waiting:
            buffer += waiting
            while b"\n" in buffer:
                line, buffer = buffer.split(b"\n", 1)
                if len(line) > LINE_MAX:
                    buffer = b""
                    continue
                process_line(bridge, line.decode("utf-8", "replace"), emit)
        import time

        time.sleep_ms(2)


def main():
    bridge = Bridge()
    if HARDWARE:
        run_uart(bridge)
    else:
        run_stdio(bridge)


if __name__ == "__main__":
    main()
