# Demo narrative: from parts to governed action

Run `npm run demo:robotics` after `npm install` and `npm run build`.

The demo is a deterministic, fully simulated workbench. It registers an ESP32, arm, chamber, actuators, sensors, and mobile base in one runtime, then shows the product story:

1. **Inventory:** print stable device IDs, classes, and lifecycle state.
2. **Actuation:** invoke motor, servo, and stepper capabilities through one runtime API.
3. **Observation:** read range, IMU, encoder, limit, and force capabilities.
4. **Composition:** command a mobile base and read its pose.
5. **Governance:** attempt an unsafe velocity and observe a structured policy denial before backend execution.
6. **Inspection:** print final device state and close the runtime.

The output is a control-plane demonstration, not a robot benchmark. No physical robot moves, no customer workflow is represented, and simulated sensor values must not be presented as measurements from hardware. To demonstrate the real path, use the ESP32 firmware instructions and the `example:blink` command in the root README.

## Multi-driver composition

Run `npm run demo:composite` to expose a simulated pump driver and relay driver as one `system.fluid_rig` device. The demo shows capability routing, driver-attributed events, aggregated operational state, and an explicit safe-state sequence. It demonstrates composition mechanics only; it does not claim cross-driver atomicity or physical fail-safe behavior.
