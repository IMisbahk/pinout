import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { ModbusTcpClient } from '../src/tcpClient.js';
import { createRegisterMapDevice, type RegisterMapEntry } from '../src/registerMap.js';
import { decodeMbap, encodeMbap } from '../src/wire.js';

function startEchoServer(): Promise<{ server: Server; port: number }> {
  const holding = new Map<number, number>();
  const coils = new Map<number, boolean>();
  const server = createServer((socket) => {
    let buffer = Buffer.alloc(0);
    socket.on('data', (chunk: Buffer) => {
      buffer = Buffer.concat([buffer, chunk]);
      for (;;) {
        if (buffer.length < 7) return;
        const length = (buffer[4]! << 8) | buffer[5]!;
        if (buffer.length < length + 6) return;
        const frame = decodeMbap(buffer);
        buffer = buffer.subarray(length + 6);
        const fc = frame.pdu[0]!;
        const address = (frame.pdu[1]! << 8) | frame.pdu[2]!;
        let responsePdu: Uint8Array;
        if (fc === 0x03) {
          const quantity = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          const bytes = new Uint8Array(2 + quantity * 2);
          bytes[0] = 0x03;
          bytes[1] = quantity * 2;
          for (let i = 0; i < quantity; i += 1) {
            const raw = holding.get(address + i) ?? 0;
            bytes[2 + i * 2] = (raw >> 8) & 0xff;
            bytes[3 + i * 2] = raw & 0xff;
          }
          responsePdu = bytes;
        } else if (fc === 0x06) {
          holding.set(address, (frame.pdu[3]! << 8) | frame.pdu[4]!);
          responsePdu = frame.pdu;
        } else if (fc === 0x05) {
          coils.set(address, ((frame.pdu[3]! << 8) | frame.pdu[4]!) === 0xff00);
          responsePdu = frame.pdu;
        } else if (fc === 0x01) {
          const quantity = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          const bytes = new Uint8Array(2 + Math.ceil(quantity / 8));
          bytes[0] = 0x01;
          bytes[1] = Math.ceil(quantity / 8);
          for (let i = 0; i < quantity; i += 1) {
            if (coils.get(address + i))
              bytes[2 + (i >> 3)] = (bytes[2 + (i >> 3)] ?? 0) | (1 << (i % 8));
          }
          responsePdu = bytes;
        } else if (fc === 0x02) {
          // Discrete inputs: all false in this mock.
          const quantity = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          responsePdu = new Uint8Array([0x02, Math.ceil(quantity / 8)]);
        } else if (fc === 0x04) {
          // Input registers: all 0 in this mock.
          const quantity = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          responsePdu = new Uint8Array([0x04, quantity * 2]);
        } else {
          responsePdu = new Uint8Array([0x80 + fc, 0x01]);
        }
        socket.write(encodeMbap(frame.transactionId, frame.unitId, responsePdu));
      }
    });
  });
  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

describe('createRegisterMapDevice', () => {
  let port: number;
  let server: Server;
  let client: ModbusTcpClient;
  let device: ReturnType<typeof createRegisterMapDevice>;

  const map: RegisterMapEntry[] = [
    {
      name: 'temperature',
      area: 'input',
      address: 0,
      access: 'read',
      type: 'uint16',
      scale: 0.1,
      offset: -50,
      unit: 'C',
    },
    {
      name: 'setpoint',
      area: 'holding',
      address: 10,
      access: 'write',
      type: 'uint16',
      scale: 0.5,
      unit: 'C',
    },
    { name: 'pump.status', area: 'discrete', address: 20, access: 'read', type: 'bool' },
    { name: 'pump.start', area: 'coil', address: 30, access: 'write', type: 'bool' },
    { name: 'serial', area: 'holding', address: 40, access: 'read', type: 'uint16' },
  ];

  beforeAll(async () => {
    const started = await startEchoServer();
    server = started.server;
    port = started.port;
    client = new ModbusTcpClient({ host: '127.0.0.1', port, timeoutMs: 1000 });
    await client.connect();
    device = createRegisterMapDevice({ client, map });
  });

  afterAll(async () => {
    await client?.close();
    server?.close();
  });

  it('exposes capability ids with access in the name', () => {
    expect(device.capabilities.map((c) => c.id)).toEqual([
      'modbus.temperature.read',
      'modbus.setpoint.write',
      'modbus.pump.status.read',
      'modbus.pump.start.write',
      'modbus.serial.read',
    ]);
  });

  it('applies scale and offset on reads', async () => {
    // Write raw 400 to input-register simulation via holding is separate; the
    // mock's input area always returns 0 → physical = 0 * 0.1 + (-50) = -50.
    const value = await device.read('temperature');
    expect(value).toBe(-50);
  });

  it('round-trips a scaled write', async () => {
    // physical 25 C with scale 0.5 → raw 50
    await device.write('setpoint', 25);
    const raw = await client.readHoldingRegisters(10, 1);
    expect(raw).toEqual([50]);
  });

  it('round-trips coil writes', async () => {
    await device.write('pump.start', true);
    expect(await device.read('pump.status')).toBe(false); // discrete area is separate
    const coils = await client.readCoils(30, 1);
    expect(coils[0]).toBe(true);
  });

  it('refuses to write read-only entries', async () => {
    await expect(device.write('temperature', 100)).rejects.toMatchObject({
      code: 'MODBUS_MAP_READ_ONLY',
    });
    await expect(device.write('serial', 5)).rejects.toMatchObject({ code: 'MODBUS_MAP_READ_ONLY' });
  });

  it('refuses unknown entries', async () => {
    await expect(device.read('ghost')).rejects.toMatchObject({ code: 'MODBUS_MAP_UNKNOWN_ENTRY' });
    await expect(device.write('ghost', 1)).rejects.toMatchObject({
      code: 'MODBUS_MAP_UNKNOWN_ENTRY',
    });
  });

  it('rejects invalid maps at construction', async () => {
    expect(() =>
      createRegisterMapDevice({
        client,
        map: [{ name: 'x', area: 'input', address: 0, access: 'write', type: 'uint16' }],
      }),
    ).toThrowError(/must use the 'holding' area/);
    expect(() =>
      createRegisterMapDevice({
        client,
        map: [
          { name: 'a', area: 'holding', address: 0, access: 'read', type: 'uint16' },
          { name: 'a', area: 'holding', address: 1, access: 'read', type: 'uint16' },
        ],
      }),
    ).toThrowError(/Duplicate register map entry/);
  });
});
