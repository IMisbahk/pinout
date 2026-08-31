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
| `devices` | List serial ports |
| `doctor` | Node, serialport, port list, mock handshake checks |
| `pins` | ESP32 safe/forbidden pin table |
| `hello` | Connect and print capabilities |
| `invoke <action>` | Generic `device.invoke()` (`--payload '{...}'`) |
| `run [file]` | NDJSON action script on one connection |
| `blink` | Blink GPIO 2 (or `--pin`) with `--count` / `--delay` |
| `gpio write\|read\|mode\|toggle\|pulse\|pwm\|analog\|watch\|unwatch` | GPIO shortcuts |

Examples:

```bash
npm run pinout -- hello --mock
npm run pinout -- invoke gpio.write --payload '{"pin":2,"value":true}' --mock
npm run pinout -- run --mock --script '{"action":"gpio.write","payload":{"pin":2,"value":true}}'
npm run pinout -- blink --mock --count 3
npm run example:blink -- --mock
```

## MCP server

Use `@pinout/mcp` for agent integrations (no shell access):

```bash
PINOUT_MOCK=1 npm run mcp
PINOUT_PORT=/dev/cu.usbserial-10 node packages/mcp/dist/index.js
```

Configure your MCP client to launch `pinout-mcp` after `npm run build`, with `PINOUT_PORT` or `PINOUT_MOCK=1`.
