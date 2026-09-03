# @pinout/protocols-modbus

Modbus TCP and RTU protocol adapter for Pinout, with a declarative register-map
device mapper. Zero external dependencies — the wire protocol (MBAP, RTU
framing, CRC16) is implemented here.

## Status

`IMPLEMENTED` — behavior-tested against in-process servers and scripted
transports. Not yet verified against physical Modbus equipment.

## Usage

### Modbus TCP

```ts
import { ModbusTcpClient } from '@pinout/protocols-modbus';

const client = new ModbusTcpClient({ host: '192.168.1.50', port: 502, unitId: 1 });
await client.connect();
await client.writeSingleRegister(100, 42);
const registers = await client.readHoldingRegisters(100, 1);
await client.close();
```

### Modbus RTU

RTU runs over any Pinout `Transport` (e.g. serial):

```ts
import { ModbusRtuClient } from '@pinout/protocols-modbus';
import { serialPort } from '@pinout/core';

const client = new ModbusRtuClient({ transport: serialPort('/dev/ttyUSB0'), slaveAddress: 11 });
await client.start();
```

### Register maps

```ts
import { createRegisterMapDevice } from '@pinout/protocols-modbus';

const device = createRegisterMapDevice({
  client,
  map: [
    { name: 'temperature', area: 'input', address: 0, access: 'read', type: 'uint16', scale: 0.1, offset: -50, unit: 'C' },
    { name: 'pump.start', area: 'coil', address: 30, access: 'write', type: 'bool' },
  ],
});
```

Writes require `access: 'write'` in the map; unknown or read-only registers
never become writable.

## Not implemented (by design)

- TLS / Modbus Security
- Gateway routing (unit-id forwarding policies)
- Serial transport itself (bring your own Pinout transport)
- RS-485 half-duplex turnaround timing control (the RTU client enforces strict
  one-request-at-a-time instead)
