# @pinout/protocols-scpi

SCPI (Standard Commands for Programmable Instruments, SCPI-1999) instrument
layer for Pinout. Provides a command parser, a request/response client that
runs over any Pinout `Transport` (serial, TCP, loopback — anything satisfying
`@pinout/core`'s `Transport` interface), and canonical instrument classes for
common bench equipment. Zero external dependencies beyond `@pinout/core` types.

```ts
import { serialPort } from '@pinout/core';
import { ScpiClient, PowerSupply } from '@pinout/protocols-scpi';

const client = new ScpiClient(serialPort('/dev/ttyUSB0', { baudRate: 9600 }));
await client.open();

const psu = new PowerSupply(client);
await psu.setVoltage(1, 5);
await psu.setCurrent(1, 0.5);
await psu.enableOutput(1);
console.log(await psu.readVoltage(1)); // :MEAS:VOLT1?

await client.close();
```

## Support status

**IMPLEMENTED — not HARDWARE_VERIFIED.** Every class in this package is
simulation/reference-grade: it is exercised against scripted loopback
transports and speaks only standard SCPI, but none of it has been validated
against real hardware yet. Expect per-vendor quirks (response formats,
termination behavior, command availability) until a hardware pass promotes
specific instruments to HARDWARE_VERIFIED.

## Package layout

| Module | Contents |
| --- | --- |
| `src/parser.ts` | `parseScpiCommand`, `scpiCommandKey`, `parseScpiNumber`, `parseScpiErrorQueueLine`, `formatScpiNumber`, `expandMnemonic` |
| `src/client.ts` | `ScpiClient` — sequential request queueing, timeouts, IEEE 488.2 helpers, error-queue access |
| `src/errors.ts` | `ScpiError` taxonomy (`SCPI_PARSE_ERROR`, `SCPI_TIMEOUT`, `SCPI_RAW_DISABLED`, ...) |
| `src/instruments/` | `PowerSupply`, `DigitalMultimeter`, `FunctionGenerator`, `Oscilloscope` on a shared `ScpiInstrument` base |

## Parser

`parseScpiCommand(input)` returns a structured command:

```ts
parseScpiCommand(':VOLTage:LEVel:IMMediate:AMPLitude 3.3V');
// { path: ['VOLTAGE','LEVEL','IMMEDIATE','AMPLITUDE'], channel: undefined,
//   query: false, args: ['3.3V'] }
```

- **Mnemonic normalization** — headers are expanded to canonical long form via
  a built-in table of common SCPI mnemonics, so `:VOLT:LEV:IMM:AMPL` and
  `:VOLTage:LEVel:IMMediate:AMPLitude` parse identically. Mnemonics outside the
  table are preserved verbatim (uppercased); short/long equality is only
  guaranteed for table entries.
- **Numeric suffixes** — `VOLT1`, `OUTP2?` set `channel`.
- **Queries** — trailing `?` (attached or whitespace-separated) sets `query`.
- **Arguments** — numbers (`-3.25E+01`) stay numbers, `ON`/`OFF` become
  booleans, quoted strings (`'...'`, `"..."` with doubled-quote escapes) are
  unquoted, `MIN`/`MAX`/`DEF`/`UP`/`DOWN` become strings, `INF`/`NINF`/`NAN`
  map to `Infinity`/`-Infinity`/`NaN`, and unit-carrying numerics (`3.3V`,
  `1kHz`, `5 V`) are preserved verbatim as strings.
- **Comments** — `//` line comments and `/* ... */` block comments are stripped
  (outside quoted strings).
- **IEEE 488.2 common commands** — `*IDN?`, `*RST`, `*OPC?`, `*ESE 0`, ... parse
  to `path: ['*IDN']`-style headers.

## Client command surface

| Method | Command sent | Notes |
| --- | --- | --- |
| `command(cmd)` | as written | Non-query commands only; refuses queries. |
| `query(cmd)` | as written | Awaits one response line with timeout; refuses non-queries. |
| `execute(cmd)` | as written | `raw()` primitive: response for queries, `undefined` otherwise. |
| `queryNumber` / `queryBoolean` | as written | Typed response parsing. |
| `identify()` | `*IDN?` | Splits into `{ manufacturer, model, serialNumber, firmwareVersion }`. |
| `reset()` | `*RST` | Restore defaults. |
| `clearStatus()` | `*CLS` | Clear status/error queues. |
| `operationComplete()` | `*OPC?` | Resolves `true` when operations complete. |
| `readError()` / `drainErrors()` | `:SYST:ERR?` | Parses `-113,"Undefined header"` entries; code `0` ends the queue. |

Client guarantees:

- **Sequential request queueing** — all commands/queries are serialized through
  an internal queue; a second request can never interleave on the transport
  before the first is written and (for queries) its single response consumed.
- **Timeouts** — per-request (`{ timeoutMs }`) or client-wide (default 5 s);
  timeouts reject with `ScpiTimeoutError` and leave the client usable.
- **Terminator** — outgoing commands are terminated with `\n` (configurable via
  `{ terminator: '\r\n' }`); inbound lines are framed on `\n` with optional
  preceding `\r`.
- **Unsolicited lines** — device-initiated lines that no query is waiting for
  go to the `onUnsolicited` callback instead of corrupting request/response
  pairing.

## Instrument command surface

All instrument classes use only IEEE 488.2 + standard/ubiquitous SCPI. Channels
are 1-based integers. No vendor quirks are hardcoded.

### `PowerSupply`

| Method | Command |
| --- | --- |
| `setVoltage(ch, volts)` | `:VOLT<ch> <volts>` |
| `setCurrent(ch, amps)` | `:CURR<ch> <amps>` |
| `enableOutput(ch)` / `disableOutput(ch)` | `:OUTP<ch> ON` / `:OUTP<ch> OFF` |
| `readVoltage(ch)` / `readCurrent(ch)` / `readPower(ch)` | `:MEAS:VOLT<ch>?` / `:MEAS:CURR<ch>?` / `:MEAS:POW<ch>?` |

### `DigitalMultimeter`

| Method | Command |
| --- | --- |
| `measureVoltage(mode = 'dc')` | `:MEAS:VOLT:DC?` / `:MEAS:VOLT:AC?` |
| `measureCurrent(mode = 'dc')` | `:MEAS:CURR:DC?` / `:MEAS:CURR:AC?` |
| `measureResistance()` | `:MEAS:RES?` |

### `FunctionGenerator` (channel defaults to 1)

| Method | Command |
| --- | --- |
| `setFrequency(hz, ch?)` | `:SOUR<ch>:FREQ <hz>` |
| `setAmplitude(volts, ch?)` | `:SOUR<ch>:VOLT <volts>` |
| `setWaveform('sine' \| 'square' \| 'ramp' \| 'noise', ch?)` | `:SOUR<ch>:FUNC SIN` / `SQU` / `RAMP` / `NOIS` |
| `enableOutput(ch?)` / `disableOutput(ch?)` | `:OUTP<ch> ON` / `:OUTP<ch> OFF` |

### `Oscilloscope` — deliberately conservative

| Method | Command |
| --- | --- |
| `configureChannel(ch, { enabled?, coupling?, voltsPerDivision? })` | `:CHAN<ch>:DISP ON\|OFF`, `:CHAN<ch>:COUP DC\|AC`, `:CHAN<ch>:SCAL <volts>` (only provided fields are sent) |
| `captureWaveform({ channel?, format? })` | `:WAV:SOUR CHAN<ch>`, `:WAV:FORM ASC\|BYTE`, `:WAV:DATA?` |

`captureWaveform` returns `{ data, metadata }` where `data` is `number[]` for
ASCII captures (optionally unwrapped from a 488.2 definite-length block) or a
`Uint8Array` for `format: 'byte'`, and `metadata` records `{ channel, format,
points }`. The data is unscaled sample data — mapping counts to volts requires
the instrument preamble, which is vendor-specific (see below).

### `raw()` escape hatch — for human programs

Every instrument exposes `raw(command)`, which sends arbitrary SCPI and returns
the response for queries (`undefined` for non-queries). It is **deliberately
opt-in**:

```ts
const psu = new PowerSupply(client, { allowRaw: true }); // opt in explicitly
await psu.raw(':VENDOR:PRIVATE:MODE?');
```

Without `{ allowRaw: true }` it throws `ScpiRawDisabledError` (`SCPI_RAW_DISABLED`).
The underlying `ScpiClient` is not reachable from an instrument instance, so
vendor-specific traffic is always visible in the program text. Use `raw()` for
prototyping a vendor module; once a command is understood, promote it to a
typed method in a dedicated module instead of leaving `raw()` calls in
application code.

## Deliberately NOT implemented

- **Vendor-specific acquisition** — oscilloscope trigger/timebase/acquisition
  configuration, waveform preambles, and binary sample scaling differ across
  vendors (`:WAV*` vs Tektronix `:DATA*`, packed formats, channel math). The
  `:WAV` subset here is the conservative common denominator; real acquisition
  needs a per-vendor module.
- **Vendor instrument quirks** — no per-model command maps, no calibration,
  protection, or memory/preset subsystems beyond the standard surface above.
- **VISA / USBTMC / VXI-11 / HiSLIP transports** — this package is transport
  agnostic by design; bring any `@pinout/core` `Transport`. Raw USBTMC/VISA
  session layers are out of scope for Pinout core.
- **SCPI program-message chaining (`;`)** — the parser rejects `;`-separated
  command chains rather than guessing shared-prefix semantics.
- **Status-register subsystems** — `*ESE`/`*SRE`/`*STB?` polling loops and
  service-request (SRQ) handling are not built in; `onUnsolicited` is the only
  device-initiated hook.
- **Indefinite-length (`#0`) blocks** and instrument-side file systems.

## Development

```sh
npx tsc -b packages/protocols-scpi   # build
npx vitest run packages/protocols-scpi   # tests (scripted loopback transport)
npx eslint packages/protocols-scpi   # lint
```
