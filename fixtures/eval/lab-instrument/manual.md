# VoltMaster PX-3 Programmable Power Supply — SCPI Reference

Vendor: VoltMaster Instruments
Model: PX-3

## Commands

VOLT <value>      Set output voltage in volts.
CURR <value>      Set output current limit in amps.
OUTP ON|OFF       Enable or disable the output.
MEAS:VOLT?        Measure output voltage.
MEAS:CURR?        Measure output current.

Connect via serial (9600 baud) or TCP port 5025.

## Operating limits

- Output voltage range: 0 to 30 V.
- Current limit range: 0 to 5 A.
- The output must be OFF (OUTP OFF) before changing the voltage range.
