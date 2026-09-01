import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createServer, type Server } from 'node:net';
import { ModbusTcpClient } from '../src/tcpClient.js';
import {
  ModbusError,
  crc16,
  decodeMbap,
  encodeMbap,
  encodeRtu,
} from '../src/wire.js';
import { ModbusRtuClient } from '../src/rtuClient.js';
import type { Transport } from '@pinout/core';

/** In-process Modbus TCP server: answers reads/writes from a tiny register bank. */
function startMockServer(): Promise<{ server: Server; port: number }> {
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
          const values: number[] = [];
          for (let i = 0; i < quantity; i += 1) values.push(holding.get(address + i) ?? 0);
          const bytes = new Uint8Array(2 + quantity * 2);
          bytes[0] = 0x03;
          bytes[1] = quantity * 2;
          for (const [i, value] of values.entries()) {
            bytes[2 + i * 2] = (value >> 8) & 0xff;
            bytes[3 + i * 2] = value & 0xff;
          }
          responsePdu = bytes;
        } else if (fc === 0x06) {
          const value = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          holding.set(address, value);
          responsePdu = frame.pdu;
        } else if (fc === 0x05) {
          const value = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          coils.set(address, value === 0xff00);
          responsePdu = frame.pdu;
        } else if (fc === 0x01) {
          const quantity = (frame.pdu[3]! << 8) | frame.pdu[4]!;
          const bytes = new Uint8Array(2 + Math.ceil(quantity / 8));
          bytes[0] = 0x01;
          bytes[1] = Math.ceil(quantity / 8);
          for (let i = 0; i < quantity; i += 1) {
            if (coils.get(address + i)) bytes[2 + (i >> 3)] = (bytes[2 + (i >> 3)] ?? 0) | (1 << (i % 8));
          }
          responsePdu = bytes;
        } else {
          // Exception: illegal function
          responsePdu = new Uint8Array([0x80 + fc, 0x01]);
        }
        socket.write(encodeMbap(frame.transactionId, frame.unitId, responsePdu));
      }
    });
  });

  return new Promise((resolve) => {
    server.listen(0, '127.0.0.1', () => {
      const address = server.address() as { port: number };
      resolve({ server, port: address.port });
    });
  });
}

/** Binary loopback transport scripted to answer each write with canned frames. */
class ScriptedBinaryTransport implements Transport {
  readonly kind = 'loopback';
  private responses: Uint8Array[] = [];
  private writableController: ((data: Uint8Array) => void) | undefined;
  private readonly queue: Uint8Array[] = [];
  private notify: (() => void) | undefined;

  constructor(private readonly responder: (request: Uint8Array) => Uint8Array | Uint8Array[]) {
    void this.writableController;
  }

  get readable(): AsyncIterable<Uint8Array> {
    const iterate = async function* (bus: ScriptedBinaryTransport): AsyncGenerator<Uint8Array> {
      while (bus.queue.length > 0 || !bus.closedFlag) {
        if (bus.queue.length === 0) {
          await new Promise<void>((resolve) => {
            bus.notify = resolve;
          });
        }
        if (bus.queue.length > 0) yield bus.queue.shift()!;
        else if (bus.closedFlag) return;
      }
    };
    return iterate(this);
  }

  private closedFlag = false;

  async open(): Promise<void> {}

  async close(): Promise<void> {
    this.closedFlag = true;
    this.notify?.();
  }

  async write(data: Uint8Array): Promise<void> {
    const responses = this.responder(data);
    for (const response of Array.isArray(responses) ? responses : [responses]) {
      this.queue.push(response);
      this.notify?.();
      this.notify = undefined;
    }
  }
}

describe('ModbusTcpClient', () => {
  let port: number;
  let server: Server;
  let client: ModbusTcpClient;

  beforeAll(async () => {
    const started = await startMockServer();
    server = started.server;
    port = started.port;
    client = new ModbusTcpClient({ host: '127.0.0.1', port, unitId: 1, timeoutMs: 1000 });
    await client.connect();
  });

  afterAll(async () => {
    await client?.close();
    server?.close();
  });

  it('writes and reads back a holding register', async () => {
    await client.writeSingleRegister(100, 0x1234);
    const values = await client.readHoldingRegisters(100, 1);
    expect(values).toEqual([0x1234]);
  });

  it('writes and reads back coils', async () => {
    await client.writeSingleCoil(5, true);
    await client.writeSingleCoil(6, false);
    const coils = await client.readCoils(5, 2);
    expect(coils.slice(0, 2)).toEqual([true, false]);
  });

  it('reads a range of registers', async () => {
    await client.writeSingleRegister(200, 10);
    await client.writeSingleRegister(201, 20);
    const values = await client.readHoldingRegisters(200, 2);
    expect(values).toEqual([10, 20]);
  });

  it('surfaces exception responses as typed errors', async () => {
    await expect(client.readInputRegisters(0, 1)).rejects.toMatchObject({
      code: 'MODBUS_EXCEPTION_ILLEGAL_FUNCTION',
    });
  });

  it('times out when the server accepts but never responds', async () => {
    const silentServer = createServer((socket) => {
      void socket; // accept and stay silent
    });
    await new Promise<void>((resolve) => silentServer.listen(0, '127.0.0.1', resolve));
    const silentPort = (silentServer.address() as { port: number }).port;
    const silent = new ModbusTcpClient({ host: '127.0.0.1', port: silentPort, timeoutMs: 50 });
    await silent.connect();
    await expect(silent.readHoldingRegisters(0, 1)).rejects.toMatchObject({ code: 'MODBUS_TIMEOUT' });
    await silent.close();
    silentServer.close();
  });

  it('rejects requests when not connected', async () => {
    const disconnected = new ModbusTcpClient({ host: '127.0.0.1', port: 1, timeoutMs: 50 });
    await expect(disconnected.readHoldingRegisters(0, 1)).rejects.toMatchObject({ code: 'MODBUS_NOT_CONNECTED' });
  });
});

describe('ModbusRtuClient', () => {
  it('round-trips a register read over a scripted transport', async () => {
    const requestFrames: Uint8Array[] = [];
    const transport = new ScriptedBinaryTransport((request) => {
      requestFrames.push(request);
      // FC 0x03 response with one register 0xABCD
      return encodeRtu(11, new Uint8Array([0x03, 0x02, 0xab, 0xcd]));
    });
    const client = new ModbusRtuClient({ transport, slaveAddress: 11, timeoutMs: 500 });
    await client.start();
    const values = await client.readHoldingRegisters(0, 1);
    expect(values).toEqual([0xabcd]);
    // The request we sent must carry a correct CRC.
    const sent = requestFrames[0]!;
    const expectedCrc = crc16(sent.subarray(0, sent.length - 2));
    expect(sent[sent.length - 2]! | (sent[sent.length - 1]! << 8)).toBe(expectedCrc);
    await client.close();
  });

  it('rejects an inflight second request', async () => {
    const transport = new ScriptedBinaryTransport(() => encodeRtu(3, new Uint8Array([0x03, 0x02, 0, 0])));
    const client = new ModbusRtuClient({ transport, slaveAddress: 3, timeoutMs: 500 });
    await client.start();
    void client.readHoldingRegisters(0, 1); // intentionally unawaited
    await expect(client.readHoldingRegisters(2, 1)).rejects.toMatchObject({ code: 'MODBUS_INFLIGHT' });
    await client.close();
  });

  it('validates the slave address range at construction', () => {
    const transport = new ScriptedBinaryTransport(() => new Uint8Array(0));
    expect(() => new ModbusRtuClient({ transport, slaveAddress: 0 })).toThrowError(ModbusError);
    expect(() => new ModbusRtuClient({ transport, slaveAddress: 248 })).toThrowError(ModbusError);
  });

  it('times out when no response arrives', async () => {
    const transport = new ScriptedBinaryTransport(() => []);
    const client = new ModbusRtuClient({ transport, slaveAddress: 1, timeoutMs: 40 });
    await client.start();
    await expect(client.readHoldingRegisters(0, 1)).rejects.toMatchObject({ code: 'MODBUS_TIMEOUT' });
    await client.close();
  });
});
