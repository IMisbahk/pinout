# Weird Sensor — Reference External Pinout Module

This package lives **outside** `@pinout/core` and demonstrates the Sprint 3 external module workflow.

## Quick start

From the Pinout repository root:

```bash
# Build the module
cd examples/external-module/weird-sensor
npm install
npm run build

# Validate conformance
cd ../../..
npm run pinout -- module test ./examples/external-module/weird-sensor

# Install into local Pinout registry (~/.pinout)
npm run pinout -- module install ./examples/external-module/weird-sensor

# Register a device
npm run pinout -- device add sensor-01 --module weird-sensor/thermometer

# List configured devices
npm run pinout -- devices

# Invoke
npm run pinout -- invoke sensor-01 temperature.read '{}'
```

## MCP

With devices configured in `~/.pinout/devices.json`:

```bash
PINOUT_CONFIG=~/.pinout/devices.json PINOUT_DEMO=heterogeneous npm run mcp
```

Tools such as `sensor_01__temperature_read` appear automatically — no changes to `@pinout/mcp`.

## Security

Pinout modules are **executable local code**. Only install modules you trust.

## Configuration

Device backend options (in `devices.json`):

```json
{
  "config": {
    "host": "localhost",
    "port": 8765,
    "simulated": true
  }
}
```
