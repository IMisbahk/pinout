# ESP32 classic HIL procedure

This procedure requires a real ESP32 DevKit (CP2102 or CH340), a USB data
cable, and a low-voltage LED/resistor or meter on GPIO 2. Run from the repo
root and record command output verbatim.

1. Record OS, Node, PlatformIO, adapter VID/PID, board silkscreen, and the
   firmware source SHA. Build and flash `pio run -e esp32dev -t upload`.
2. Run `npm run pinout -- ports`, then `pinout discover`; confirm discovery is
   read-only. Enroll explicitly with `pinout enroll --port <path> --id esp32
   --yes` and inspect the identity fields in `~/.pinout/devices.json`.
3. Connect once with default serial settings and capture `ready` or the
   bounded `sys.hello` fallback. Repeat with `resetOnConnect: false` and note
   whether the adapter resets the board.
4. Through the governed daemon, drive GPIO 2 high/low, register a watch and
   capture one `gpio.changed` event. Invoke `gpio.stopAll` and measure that
   the output is low.
5. Run the coffee-rig scenario: start, stop, unplug mid-operation, reconnect,
   and halt. Preserve journal excerpts showing each distinct outcome.

No HIL result is implied by this checklist; complete records belong under
`hardware/records/` and must include date and operator.
