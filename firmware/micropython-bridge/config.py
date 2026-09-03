"""Deployment-configurable pin and bus defaults.

Edit this file per-board before installing the bridge. The bridge performs
runtime capability detection and stays conservative: when a peripheral is
unavailable it reports a protocol error instead of guessing.
"""

# UART used for the NDJSON protocol when running on real hardware.
UART_ID = 0
UART_BAUD = 115200
UART_TX_PIN = 0
UART_RX_PIN = 1

# Default I2C bus pins (board-specific — check your pinout diagram).
I2C_SCL_PIN = 9
I2C_SDA_PIN = 8
I2C_FREQUENCY = 100000

# Default SPI bus pins.
SPI_SCK_PIN = 6
SPI_MOSI_PIN = 7
SPI_MISO_PIN = 4
SPI_FREQUENCY = 1000000

# Pins the bridge must never drive (flash, strap, power).
RESERVED_PINS = frozenset()

# Maximum software-tracked watch points.
MAX_WATCHES = 8
