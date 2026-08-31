# Pinout

Pinout is building the software layer that makes physical hardware programmable through clean, composable interfaces — for people writing programs and for agents that need tools instead of datasheets.

Hardware today is still reached through vendor SDKs, GPIO libraries, serial protocols, and board-specific quirks. Pinout's job is to sit above that fragmentation:

```text
AI / Application
       │
       ▼
   Pinout SDK
       │
       ▼
Device / Driver / Adapter
       │
       ▼
 Physical Hardware
```

A device exposes **capabilities** (named actions with typed inputs, outputs, and safety notes). The first capability family is GPIO. The architecture is not GPIO-shaped: a later motor, sensor, or arm is another capability on a device, not a rewrite of the core.

**This repository is early and experimental.** The useful surface area is a TypeScript SDK, CLI, MCP adapter, simulated ESP32, and firmware that can drive a pin on a real ESP32 over serial.

## Quick start

Node 20+ is required.

```bash
git clone https://github.com/imisbahk/pinout.git
cd pinout
npm install
npm test
```

That run uses a simulated ESP32. No board is required.

Talk to the simulator through the CLI:

```bash
npm run pinout -- hello --mock
npm run pinout -- doctor
npm run pinout -- gpio write 2 high --mock
npm run pinout -- gpio read 2 --mock
npm run pinout -- blink --mock
```

Or from TypeScript:

```ts
import { connect, simulatedEsp32 } from '@pinout/core';

const board = await connect({ transport: simulatedEsp32() });
await board.gpio.write(2, true);
await board.close();
```

Copy [.env.example](.env.example) to `.env` to set a default serial port and timeouts.

## ESP32 hardware demo

1. Flash `firmware/esp32-bridge` to a classic ESP32 DevKit (WROOM / 30-pin). Instructions are in [firmware/esp32-bridge/README.md](firmware/esp32-bridge/README.md).
2. Find the serial port:

```bash
npm run pinout -- devices
```

On macOS prefer `/dev/cu.*`. On Linux this is often `/dev/ttyUSB0`.

3. Handshake, then blink the onboard LED (usually GPIO 2):

```bash
npm run pinout -- hello --port /dev/cu.usbserial-10
npm run pinout -- gpio write 2 high --port /dev/cu.usbserial-10
npm run pinout -- gpio write 2 low --port /dev/cu.usbserial-10
```

The same path from the SDK:

```ts
import { connect } from '@pinout/core';
import { serialPort } from '@pinout/core/serial';

const board = await connect({
  transport: serialPort({ path: '/dev/cu.usbserial-10' }),
});

await board.gpio.write(2, true);
await board.close();
```

`npm run example:blink -- --port /dev/cu.usbserial-10` runs [examples/blink.ts](examples/blink.ts).

Opening the serial port usually resets the ESP32. The SDK waits for a `ready` event and ignores ROM boot logs.

## Scripts

```bash
npm test              # unit + simulator integration tests
npm run test:coverage # coverage report for @pinout/core
npm run lint
npm run typecheck
npm run build
npm run pinout --      # CLI (builds first)
npm run example:blink -- --mock
npm run example:pwm -- --mock
npm run example:analog -- --mock
npm run example:watch -- --mock
npm run mcp            # MCP stdio server (simulator; set PINOUT_PORT for hardware)
```

## Architecture

| Piece | Responsibility |
| --- | --- |
| `@pinout/core` | Device, capabilities, protocol, transports, ESP32 pin rules, simulator |
| `@pinout/cli` | `pinout` commands that call the SDK |
| `@pinout/mcp` | MCP stdio server — tools from `toAgentTools()`, calls via `invoke()` |
| `firmware/esp32-bridge` | Minimal ESP32 firmware speaking protocol v1 over UART |

Transports are replaceable. Drivers own board-specific knowledge (ESP32 flash pins, input-only GPIOs). The core does not catalog every device ever made.

Documentation:

- [docs/architecture.md](docs/architecture.md)
- [docs/protocol.md](docs/protocol.md)
- [docs/capabilities.md](docs/capabilities.md)
- [docs/cli.md](docs/cli.md)
- [docs/testing.md](docs/testing.md)
- [CHANGELOG.md](CHANGELOG.md)
- [CONTRIBUTING.md](CONTRIBUTING.md)

## Agents

Capabilities carry enough structure to become tools (`name`, `description`, input/output JSON Schema, safety annotations). `device.toAgentTools()` returns that shape.

Run the MCP adapter over stdio:

```bash
PINOUT_MOCK=1 npm run mcp
```

Configure your MCP client to launch `node packages/mcp/dist/index.js` (after `npm run build`) with `PINOUT_PORT` or `PINOUT_MOCK=1`. The SDK itself stays MCP-free; only `@pinout/mcp` depends on `@modelcontextprotocol/sdk`.

## Safety

Pinout validates inputs, connection state, timeouts, and known-bad ESP32 pins. It cannot see wiring, voltage, or what the pin is connected to. Physical safety stays with firmware, the mechanism, and the operator. See the safety section in [docs/architecture.md](docs/architecture.md).

## Status

Experimental. The protocol, package layout, and GPIO API will change. The current goal is a foundation that actually talks to hardware, not a complete robotics platform.
