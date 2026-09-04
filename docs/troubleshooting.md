# Troubleshooting

- Confirm the daemon is reachable on its configured loopback URL and inspect `pinout daemon status`.
- A serial connect can reset classic boards through DTR/RTS; reconnect and wait for the device lifecycle to settle.
- Use `npm run release:dry-run` to inspect package contents without creating archives or contacting a registry.
- PlatformIO compile success is not hardware verification. Record any physical test under `hardware/records/` before changing a catalog status.
