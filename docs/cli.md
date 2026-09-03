# CLI reference

The `pinout` command wraps `@pinout/core`. Most commands open one connection, run actions, and close. `run`, `blink`, and inline scripts keep a single persistent connection.

```bash
npm run pinout -- <command> [options]
```

## Device options

| Option | Env | Default | Description |
| --- | --- | --- | --- |
| `--port <path>` | `PINOUT_PORT` | — | Serial port path |
| `--mock` | — | false | Simulated ESP32 |
| `--baud <rate>` | `PINOUT_BAUD` | 115200 | Serial baud rate |
| `--timeout <ms>` | `PINOUT_TIMEOUT` | 5000 | Request timeout |
| `--json` | — | false | Structured JSON output |

Provide either `--port` (or `PINOUT_PORT`) or `--mock`.

## Commands

| Command | Description |
| --- | --- |
| `devices` | List configured/active Pinout runtime devices |
| `ports` | List discoverable serial ports |
| `doctor` | Node, serialport, port list, mock handshake checks |
| `pins` | ESP32 safe/forbidden pin table |
| `hello` | Connect and print capabilities (single device) |
| `exec <action>` | Invoke action on directly connected device (`--payload '{...}'`) |
| `invoke <deviceId> <capability>` | Invoke capability on runtime device |
| `module create\|test\|install\|list\|inspect\|uninstall` | External module workflow |
| `device add\|remove\|list\|inspect` | Persistent device registry |
| `runtime start` | Bootstrap runtime from `~/.pinout/devices.json` |
| `runtime inspect [deviceId]` | Inspect identity, health, backend mode, state, and capabilities |
| `runtime capabilities [deviceId]` | List capability schemas and physical-output classification |
| `runtime tools [deviceId]` | List the agent/MCP tool projection |
| `runtime emergency-stop [deviceId] --yes` | Best-effort advertised stop actions; not a certified E-stop |
| `run [file]` | NDJSON action script on one connection |
| `blink` | Blink GPIO 2 (or `--pin`) with `--count` / `--delay` |
| `gpio write\|read\|mode\|toggle\|pulse\|pwm\|analog\|watch\|unwatch` | GPIO shortcuts |

Examples:

```bash
npm run pinout -- hello --mock
npm run pinout -- exec gpio.write --payload '{"pin":2,"value":true}' --mock
npm run pinout -- module test ./examples/external-module/weird-sensor
npm run pinout -- module install ./examples/external-module/weird-sensor
npm run pinout -- device add sensor-01 --module weird-sensor/thermometer --simulated
npm run pinout -- devices
npm run pinout -- invoke sensor-01 temperature.read --payload '{}'
npm run pinout -- --json runtime inspect
npm run pinout -- runtime capabilities esp32-01
npm run pinout -- runtime emergency-stop esp32-01 --yes
npm run pinout -- blink --mock --count 3
```

The stop command invokes only stop capabilities advertised by each selected device, records unsupported devices and partial failures, and requires `--yes`. It cannot replace a hardware interlock or safety-rated emergency-stop circuit.

## Module ecosystem

See [build-a-module.md](build-a-module.md) for the full external module developer guide.

```bash
pinout module create my-sensor
pinout module test ./my-sensor
pinout module install ./my-sensor
pinout device add sensor-01 --module my-sensor/device --simulated
```

Local state lives in `~/.pinout/` (override with `PINOUT_HOME`). Device config path: `PINOUT_CONFIG` or `~/.pinout/devices.json`.

## MCP server

Use `@pinout/mcp` for agent integrations (no shell access):

```bash
PINOUT_MOCK=1 npm run mcp                              # single simulated ESP32
PINOUT_DEMO=heterogeneous npm run mcp                  # built-in demo runtime
PINOUT_CONFIG=~/.pinout/devices.json npm run mcp       # configured devices + external modules
```

Configure your MCP client to launch `pinout-mcp` after `npm run build`, with `PINOUT_PORT` or `PINOUT_MOCK=1`.
