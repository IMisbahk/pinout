# LidarOne L4 Rangefinder Datasheet

Vendor: LidarOne
Model: L4

The L4 is a time-of-flight distance sensor.

- Interface: UART 115200 or I2C (address 0x52).
- `distance_read()` returns the measured distance.
- Measurement range: 0.15 m to 12 m.
- Update rate: 240 Hz maximum.
- The sensor must not be pointed at the sun; readings outside the range
  return an error code, not a clamped value.
