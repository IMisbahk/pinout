# NexCore NX-32 Firmware Kit

Vendor: NexCore Systems
Model: NX-32

## Overview

The NX-32 is a 32-bit microcontroller module with 18 general-purpose IO pins,
a 4-channel 12-bit ADC, and hardware PWM on 6 pins.

## Interface

Connect over serial UART at 115200 baud.

## GPIO API

- `gpio_write(pin, value)` — set pin output level (0 or 1)
- `gpio_read(pin)` — read pin level
- `i2c_write(address, data)` — write bytes to I2C bus
- `i2c_read(address, length)` — read bytes from I2C bus

## Electrical limits

- GPIO output current: maximum 40 mA per pin.
- ADC input voltage: 0 to 3.3 V.
- Operating temperature: -40 C to 85 C.
