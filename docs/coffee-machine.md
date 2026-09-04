# Coffee machine example

The coffee example demonstrates the governed runtime with a simulated machine
and the same semantic contract mapped to an explicitly configured ESP32 bridge.
It exercises lease acquisition, dry-run, idempotent operation retry, progress,
and emergency-stop to a halted state.

Run the deterministic simulator demo with:

```bash
npm run demo:coffee
```

The ESP32 backend requires explicit GPIO/ADC assignments and a declared
`temperatureScaleCPerCount`; Pinout does not invent electrical mappings or
temperature calibration. Use low-voltage, current-limited test hardware only.
Do not connect mains, pumps, heaters, or pressure systems without an
appropriate hardware safety review and independent physical interlocks.

