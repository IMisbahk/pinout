# ESP32 Classic Reference Circuit: Low-Voltage LED & Sensor Fixture

## Overview

This document specifies the reference low-voltage circuit fixture for the alpha ESP32 classic target (`firmware/boards/esp32-devkit-v1.json`). It provides a deterministic, electrically safe test harness for verifying host-device communication, explicit arming/disarming, per-output safe states, active-high and active-low output behavior, and sensor edge observation without external power supplies or hazardous voltages.

---

## 1. Board Identification

### 1.1 Target Board Specification

| Property | Value | Notes |
| :--- | :--- | :--- |
| **Board Identifier** | `esp32-devkit-v1` | Matches `firmware/boards/esp32-devkit-v1.json` |
| **Module** | ESP-WROOM-32 | Metal RF shield enclosure |
| **SoC / MCU** | ESP32-D0WD (or ESP32-D0WDQ6) | Dual Tensilica Xtensa 32-bit LX6 @ 240 MHz |
| **Form Factor** | 30-pin Dual-In-Line (DIP) DevKit | 15 pins per side, 0.1" (2.54 mm) pin pitch |
| **Breadboard Width** | ~25.4 mm (1.0 inch) row spacing | Leaves 1 row available on standard breadboards |
| **Logic Voltage** | 3.3 V DC | All GPIOs operate strictly at 3.3 V logic levels |
| **Power Source** | USB 5 V DC only | Onboard low-dropout linear regulator (AMS1117-3.3 or ME6211) |

### 1.2 Visual Identification Checklist

Confirm all of the following on the physical board prior to connecting:

1. **Metal Shield:** Engraved with `ESP-WROOM-32` and Espressif FCC ID logo.
2. **Buttons:** Two tactile pushbuttons flanking the USB connector:
   - `EN` (or `RST`): Reset pin.
   - `BOOT` (or `IO0`): Bootloader mode selection connected to GPIO 0.
3. **USB Interface Chip:** IC package adjacent to the USB socket:
   - Silicon Labs CP2102 (QFN-28 package, square).
   - OR WCH CH340C/CH340G (SOIC-16 or SOP-16 package, rectangular).
4. **Onboard Indicators:**
   - Red Power LED (illuminated whenever 3.3 V rail is energized).
   - Blue User LED (wired to GPIO 2).
5. **Pin Silkscreen:** 30 pins labeled starting from `EN`, `VP`, `VN`, `D34`, `D35`, `D32`, `D33`, `D25`, `D26`, `D27`, `D14`, `D12`, `D13`, `GND`, `VIN` on left header, and `D23`, `D22`, `TX0`, `RX0`, `D21`, `D19`, `D18`, `D5`, `D17`, `D16`, `D4`, `D2`, `D15`, `GND`, `3V3` on right header.

### 1.3 USB Identification

When connected via USB data cable, the host operating system reports:

- **CP2102 Bridge:**
  - USB Vendor ID (VID): `0x10c4` (Silicon Laboratories)
  - USB Product ID (PID): `0xea60` (CP210x UART Bridge)
  - macOS Device Node: `/dev/cu.usbserial-*` or `/dev/cu.SLAB_USBtoUART`
  - Linux Device Node: `/dev/ttyUSB0` (udev: `10c4:ea60`)
- **CH340 Bridge:**
  - USB Vendor ID (VID): `0x1a86` (QinHeng Electronics)
  - USB Product ID (PID): `0x7523` (CH340 Serial)
  - macOS Device Node: `/dev/cu.wchusbserial*`
  - Linux Device Node: `/dev/ttyUSB0` (udev: `1a86:7523`)

---

## 2. Firmware Identity & Handshake Contract

The device must report exact identity metadata upon serial initialization (`ready` broadcast event) or upon receiving a `sys.hello` command.

### 2.1 Handshake Fields

```json
{
  "v": 1,
  "ok": true,
  "result": {
    "firmware": "esp32-bridge",
    "version": "0.0.1-alpha.1",
    "protocol": 1,
    "capabilities": [
      "sys.hello",
      "sys.ping",
      "sys.info",
      "gpio.mode",
      "gpio.write",
      "gpio.batchWrite",
      "gpio.stopAll",
      "gpio.read",
      "gpio.toggle",
      "gpio.pulse",
      "gpio.pwm",
      "gpio.analogRead",
      "gpio.watch",
      "gpio.unwatch",
      "i2c.begin",
      "i2c.write",
      "i2c.read",
      "i2c.scan",
      "spi.begin",
      "spi.transfer",
      "gpio.servo",
      "gpio.motor"
    ]
  }
}
```

### 2.2 Watchdog, Arming & Safe-State Model

In accordance with the Pinout protocol and runtime architecture:

1. **Boot State is Disarmed:** Upon reset or initial power-up, the device boots into an un-armed safe state. No actuation occurs until explicitly armed by the host session.
2. **Declared Safe State per Output:** Each output pin configuration specifies its electrical safe level and polarity.
3. **Negotiated Watchdog:** The host and device negotiate a heartbeat interval with a device-local hardware/software timer. If host communication ceases or the watchdog expires, the device automatically trips to the declared safe state for all outputs.
4. **No Auto-Resume:** Following a watchdog trip, link disconnect, or host process termination, the device remains disarmed upon reconnection until a complete re-commissioning handshake and explicit arm command are performed.

---

## 3. Circuit Components & Electrical Specifications

### 3.1 Primary Output: Active-High LED Fixture (GPIO 2)

- **Pin Assignment:** GPIO 2 (also drives the onboard blue LED).
- **Circuit Configuration:** GPIO 2 $\rightarrow$ Series Resistor $R_1$ $\rightarrow$ LED1 Anode ($+$) $\rightarrow$ LED1 Cathode ($-$) $\rightarrow$ GND.
- **Electrical Calculations at 3.3 V:**
  - Logic High Output Voltage ($V_{OH}$): $3.3\text{ V}$
  - Standard Red LED Forward Voltage ($V_F$): $\approx 2.0\text{ V}$
  - Target Forward Current ($I_F$): $3.9\text{ mA}$ to $4.0\text{ mA}$ (well within ESP32 per-pin source limit of $12\text{ mA}$)
  - Voltage across resistor: $V_R = V_{OH} - V_F = 3.3\text{ V} - 2.0\text{ V} = 1.3\text{ V}$
  - Resistance: $R_1 = \frac{V_R}{I_F} = \frac{1.3\text{ V}}{0.00394\text{ A}} \approx 330\,\Omega$
  - Standard Resistor: **$330\,\Omega$** ($1/4\text{ W}$ or $1/8\text{ W}$, $5\%$ tolerance).
  - Power Dissipation: $P = I^2 \cdot R = (0.00394)^2 \cdot 330 = 5.1\text{ mW}$ (safe).
- **Polarity:** `active-high` (Logic `HIGH` / 3.3 V energizes the LED; Logic `LOW` / 0 V de-energizes it).
- **Declared Safe Level:** `LOW` (0 / `false`).

### 3.2 Secondary Output: Active-Low LED Fixture (GPIO 4)

- **Pin Assignment:** GPIO 4.
- **Circuit Configuration:** 3.3 V Rail $\rightarrow$ Series Resistor $R_2$ ($330\,\Omega$) $\rightarrow$ LED2 Anode ($+$) $\rightarrow$ LED2 Cathode ($-$) $\rightarrow$ GPIO 4.
- **Electrical Calculations at 3.3 V:**
  - Supply Voltage: $3.3\text{ V}$
  - When GPIO 4 is driven `LOW` ($0\text{ V}$), GPIO 4 sinks current from the 3.3 V rail to GND.
  - Sinking Current: $I_{\text{sink}} = \frac{3.3\text{ V} - 2.0\text{ V}}{330\,\Omega} \approx 3.94\text{ mA}$ (well within ESP32 sink limit of $28\text{ mA}$).
  - When GPIO 4 is driven `HIGH` ($3.3\text{ V}$), potential difference is $0\text{ V}$, turning LED OFF.
- **Polarity:** `active-low` (Logic `LOW` / 0 V energizes the LED; Logic `HIGH` / 3.3 V de-energizes it).
- **Declared Safe Level:** `HIGH` (1 / `true`).
- **Coverage Status:** Retained as **PENDING** until verified during a physical HIL test run.

### 3.3 Input Sensor: Tactile Button / Digital Switch (GPIO 13)

- **Pin Assignment:** GPIO 13.
- **Circuit Configuration:** GPIO 13 connected to one terminal of a momentary tactile pushbutton switch ($S_1$); opposite terminal connected directly to GND.
- **Pull Configuration:**
  - Internal Pull-Up: Configured via firmware `gpio.mode` with mode `"pullup"` ($\approx 45\text{ k}\Omega$ internal resistance).
  - Optional External Pull-Up: $10\text{ k}\Omega$ resistor from GPIO 13 to 3.3 V rail for high-noise environments.
- **Electrical Behavior:**
  - Switch Open (idle / released): GPIO 13 pulled `HIGH` ($3.3\text{ V}$).
  - Switch Closed (pressed): GPIO 13 shorted to GND (`LOW` / $0\text{ V}$).
- **Debounce & Filtering:**
  - Expected mechanical switch contact bounce: $5\text{ ms}$ to $20\text{ ms}$.
  - Host runtime or driver edge-detection applies a $30\text{ ms}$ debounce window on `gpio.changed` events.

---

## 4. Forbidden & Restricted Pins

Refer to `firmware/boards/esp32-devkit-v1.json` for board constraints. Never wire test fixtures to the following pins:

| Pin Group | GPIO Numbers | Restriction Reason |
| :--- | :--- | :--- |
| **Integrated SPI Flash** | GPIO 6, 7, 8, 9, 10, 11 | Directly wired to onboard SPI flash memory. Driving or reading these pins crashes MCU execution. |
| **Boot Strap: MTDI** | GPIO 12 | Samples flash voltage at boot. If held `HIGH` at reset, switches flash voltage to 1.8 V, causing boot failure. |
| **Boot Strapping Pins** | GPIO 0, 2, 5, 15 | Control bootloader mode, ROM log output, and JTAG timing. Avoid external pull-ups/pull-downs that disturb boot levels. |
| **UART0 Console** | GPIO 1 (TX0), GPIO 3 (RX0) | Dedicated to USB-UART bridge communication. External connections corrupt protocol framing. |
| **Input-Only Pins** | GPIO 34, 35, 36 (VP), 39 (VN) | Lack output driver circuitry and internal pull-ups/pull-downs. Output configuration is rejected by firmware. |

---

## 5. Power & Current Budget

- **Supply Source:** Host USB bus via Type-A to Micro-USB (or USB-C) cable.
- **External Supplies:** None permitted for this reference fixture (no AC mains, no external bench PSU, no batteries).
- **Loads:** Strictly low-voltage signal-level components. No motors, relays, solenoids, or inductive loads.
- **Current Breakdown:**

| Subsystem | Typical Current | Peak Current |
| :--- | :--- | :--- |
| ESP32 MCU (WiFi/BT disabled, 240 MHz dual-core) | $35\text{ mA}$ | $60\text{ mA}$ |
| LED 1 Active-High (GPIO 2, $330\,\Omega$) | $3.94\text{ mA}$ | $4.0\text{ mA}$ |
| LED 2 Active-Low (GPIO 4, $330\,\Omega$) | $3.94\text{ mA}$ | $4.0\text{ mA}$ |
| Button $S_1$ closed (GPIO 13 internal pull-up) | $0.07\text{ mA}$ | $0.1\text{ mA}$ |
| **Total System Draw** | **$\approx 43\text{ mA}$** | **$< 70\text{ mA}$** |

*Budget Margin:* The $70\text{ mA}$ peak draw is well within the $500\text{ mA}$ capability of standard USB 2.0 host ports and the $800\text{ mA}$ rating of the onboard AMS1117 linear regulator.

---

## 6. Wiring Table & ASCII Schematic

### 6.1 Wiring Connection Table

| From (ESP32 DevKit V1) | Component | To Component Pin / Rail | Purpose / Signal |
| :--- | :--- | :--- | :--- |
| **GPIO 2** (D2) | Resistor $R_1$ ($330\,\Omega$) | Anode of LED 1 (Red) | Active-High Output |
| Cathode of LED 1 | Breadboard wire | **GND** Rail | Return Path |
| **3.3 V** (3V3) | Resistor $R_2$ ($330\,\Omega$) | Anode of LED 2 (Green) | Active-Low Power Source |
| Cathode of LED 2 | Breadboard wire | **GPIO 4** (D4) | Active-Low Sink Output |
| **GPIO 13** (D13) | Switch $S_1$ (Momentary) | Switch Terminal 1 | Digital Input / Sensor |
| Switch $S_1$ Terminal 2 | Breadboard wire | **GND** Rail | Switch Return Path |
| **GND** | Breadboard wire | Breadboard Ground Rail | Common Ground Reference |

### 6.2 ASCII Circuit Schematic

```text
       +3.3V (ESP32 3V3 Pin)
         |
         +-----------------------------+
         |                             |
        [R2: 330 Ohm]                  |
         |                             |
       (LED2: Green)                   |
         | (Cathode)                   |
         |                             |
      GPIO 4 [ACTIVE-LOW OUTPUT]       |
                                       |
                                       |
      GPIO 2 [ACTIVE-HIGH OUTPUT]      |
         |                             |
        [R1: 330 Ohm]                  |
         |                             |
       (LED1: Red)                     |
         | (Cathode)                   |
         |                             |
         +-----------------------------+
         |                             |
        GND                            |
                                       |
      GPIO 13 [INPUT, PULL-UP]         |
         |                             |
        /  Switch S1 (Button)          |
       o   o                           |
         |                             |
        GND ---------------------------+
```

---

## 7. Commissioning Checklist

Follow these step-by-step procedures to commission a reference fixture. **Never execute automated firmware flashing on an unidentified or unverified board.**

1. **Step 1: Visual & Hardware Identification**
   - Confirm ESP32-WROOM-32 30-pin board geometry.
   - Inspect CP2102 or CH340 USB-UART bridge.
   - Verify all wiring against Section 6 while USB is disconnected.

2. **Step 2: USB Enumeration & Port Verification**
   - Connect USB cable to host.
   - Run `npm run pinout -- ports` or `pinout discover`.
   - Confirm candidate port appears (e.g. `/dev/cu.usbserial-0001` or `/dev/ttyUSB0`) with expected VID/PID.

3. **Step 3: Verify Firmware Identity**
   - Query handshake: `npm run pinout -- hello --port <PORT>`.
   - Confirm `firmware` equals `"esp32-bridge"`, `protocol` equals `1`, and `version` is reported.

4. **Step 4: Configure Output Polarities & Safe States**
   - Using the watchdog/arming handshake described in `docs/protocol.md`:
     - Configure GPIO 2: `mode: "output"`, `polarity: "active-high"`, `safeLevel: 0 (LOW)`.
     - Configure GPIO 4: `mode: "output"`, `polarity: "active-low"`, `safeLevel: 1 (HIGH)`.
     - Configure GPIO 13: `mode: "pullup"`.
   - Verify that prior to arming, both LEDs remain unlit (safe state).

5. **Step 5: Explicit Arming & Functional Actuation**
   - Issue explicit session arm command.
   - Drive GPIO 2 `HIGH` $\rightarrow$ verify LED 1 illuminates (red).
   - Drive GPIO 2 `LOW` $\rightarrow$ verify LED 1 extinguishes.
   - Drive GPIO 4 `LOW` $\rightarrow$ verify LED 2 illuminates (green).
   - Drive GPIO 4 `HIGH` $\rightarrow$ verify LED 2 extinguishes.
   - Register watch on GPIO 13 $\rightarrow$ press button $S_1$ $\rightarrow$ observe `gpio.changed` event with `value: false` (pressed).
   - Release button $S_1$ $\rightarrow$ observe `gpio.changed` event with `value: true` (released).

6. **Step 6: Disarm & Verify Safe-State Fallback**
   - Issue disarm command.
   - Measure and physically observe that GPIO 2 is `LOW` and GPIO 4 is `HIGH` (both LEDs off).
