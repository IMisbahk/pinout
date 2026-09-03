# AeroSense Q7 Environmental Probe

Vendor: AeroSense
Model: Q7

The Q7 measures humidity and barometric pressure.

- Interface: I2C address 0x76 or serial at 9600 baud.
- `humidity_read()` returns relative humidity.
- `pressure_read()` returns pressure.
- Operating range: 0 to 60 C ambient.
- Humidity accuracy: plus or minus 2 percent RH.
- Maximum sampling rate: 10 Hz. Faster polling returns the last value.
