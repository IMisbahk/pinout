import { createServer, type Server, type Socket } from 'node:net';
import { decodeMbap, encodeMbap } from './wire.js';

export interface SimulatedModbusServerOptions {
  host?: string;
  port?: number;
  initialCoils?: Record<number, boolean>;
  initialDiscreteInputs?: Record<number, boolean>;
  initialHoldingRegisters?: Record<number, number>;
  initialInputRegisters?: Record<number, number>;
}

export class SimulatedModbusServer {
  private server: Server | undefined;
  private readonly sockets = new Set<Socket>();
  private readonly coils = new Map<number, boolean>();
  private readonly discreteInputs = new Map<number, boolean>();
  private readonly holdingRegisters = new Map<number, number>();
  private readonly inputRegisters = new Map<number, number>();
  private boundPort: number | undefined;
  private readonly host: string;
  private readonly requestedPort: number;

  constructor(options: SimulatedModbusServerOptions = {}) {
    this.host = options.host ?? '127.0.0.1';
    this.requestedPort = options.port ?? 0;

    if (options.initialCoils) {
      for (const [addr, val] of Object.entries(options.initialCoils)) {
        this.coils.set(Number(addr), val);
      }
    }
    if (options.initialDiscreteInputs) {
      for (const [addr, val] of Object.entries(options.initialDiscreteInputs)) {
        this.discreteInputs.set(Number(addr), val);
      }
    }
    if (options.initialHoldingRegisters) {
      for (const [addr, val] of Object.entries(options.initialHoldingRegisters)) {
        this.holdingRegisters.set(Number(addr), val);
      }
    }
    if (options.initialInputRegisters) {
      for (const [addr, val] of Object.entries(options.initialInputRegisters)) {
        this.inputRegisters.set(Number(addr), val);
      }
    }
  }

  get port(): number {
    if (this.boundPort === undefined) {
      throw new Error('SimulatedModbusServer is not started.');
    }
    return this.boundPort;
  }

  async start(): Promise<{ host: string; port: number }> {
    if (this.server) {
      return { host: this.host, port: this.port };
    }

    const server = createServer((socket) => {
      this.sockets.add(socket);
      let buffer = Buffer.alloc(0);

      socket.on('data', (chunk: Buffer) => {
        buffer = Buffer.concat([buffer, chunk]);
        for (;;) {
          if (buffer.length < 7) return;
          const length = (buffer[4]! << 8) | buffer[5]!;
          if (buffer.length < length + 6) return;

          const frame = decodeMbap(buffer);
          buffer = buffer.subarray(length + 6);

          const responsePdu = this.handlePdu(frame.pdu);
          const responseFrame = encodeMbap(frame.transactionId, frame.unitId, responsePdu);
          socket.write(responseFrame);
        }
      });

      socket.on('close', () => {
        this.sockets.delete(socket);
      });

      socket.on('error', () => {
        this.sockets.delete(socket);
      });
    });

    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(this.requestedPort, this.host, () => {
        server.off('error', reject);
        const address = server.address() as { port: number };
        this.boundPort = address.port;
        this.server = server;
        resolve();
      });
    });

    return { host: this.host, port: this.boundPort! };
  }

  async close(): Promise<void> {
    for (const socket of this.sockets) {
      socket.destroy();
    }
    this.sockets.clear();

    if (this.server) {
      const server = this.server;
      this.server = undefined;
      await new Promise<void>((resolve) => {
        server.close(() => resolve());
      });
    }
  }

  getCoil(address: number): boolean {
    return this.coils.get(address) ?? false;
  }

  setCoil(address: number, value: boolean): void {
    this.coils.set(address, value);
  }

  getDiscreteInput(address: number): boolean {
    return this.discreteInputs.get(address) ?? false;
  }

  setDiscreteInput(address: number, value: boolean): void {
    this.discreteInputs.set(address, value);
  }

  getHoldingRegister(address: number): number {
    return this.holdingRegisters.get(address) ?? 0;
  }

  setHoldingRegister(address: number, value: number): void {
    this.holdingRegisters.set(address, value & 0xffff);
  }

  getInputRegister(address: number): number {
    return this.inputRegisters.get(address) ?? 0;
  }

  setInputRegister(address: number, value: number): void {
    this.inputRegisters.set(address, value & 0xffff);
  }

  private handlePdu(pdu: Uint8Array): Uint8Array {
    const fc = pdu[0]!;
    const address = (pdu[1]! << 8) | pdu[2]!;

    switch (fc) {
      case 0x01: {
        // Read Coils
        const quantity = (pdu[3]! << 8) | pdu[4]!;
        const byteCount = Math.ceil(quantity / 8);
        const bytes = new Uint8Array(2 + byteCount);
        bytes[0] = 0x01;
        bytes[1] = byteCount;
        for (let i = 0; i < quantity; i += 1) {
          if (this.getCoil(address + i)) {
            bytes[2 + (i >> 3)] = (bytes[2 + (i >> 3)] ?? 0) | (1 << (i % 8));
          }
        }
        return bytes;
      }
      case 0x02: {
        // Read Discrete Inputs
        const quantity = (pdu[3]! << 8) | pdu[4]!;
        const byteCount = Math.ceil(quantity / 8);
        const bytes = new Uint8Array(2 + byteCount);
        bytes[0] = 0x02;
        bytes[1] = byteCount;
        for (let i = 0; i < quantity; i += 1) {
          if (this.getDiscreteInput(address + i)) {
            bytes[2 + (i >> 3)] = (bytes[2 + (i >> 3)] ?? 0) | (1 << (i % 8));
          }
        }
        return bytes;
      }
      case 0x03: {
        // Read Holding Registers
        const quantity = (pdu[3]! << 8) | pdu[4]!;
        const bytes = new Uint8Array(2 + quantity * 2);
        bytes[0] = 0x03;
        bytes[1] = quantity * 2;
        for (let i = 0; i < quantity; i += 1) {
          const val = this.getHoldingRegister(address + i);
          bytes[2 + i * 2] = (val >> 8) & 0xff;
          bytes[3 + i * 2] = val & 0xff;
        }
        return bytes;
      }
      case 0x04: {
        // Read Input Registers
        const quantity = (pdu[3]! << 8) | pdu[4]!;
        const bytes = new Uint8Array(2 + quantity * 2);
        bytes[0] = 0x04;
        bytes[1] = quantity * 2;
        for (let i = 0; i < quantity; i += 1) {
          const val = this.getInputRegister(address + i);
          bytes[2 + i * 2] = (val >> 8) & 0xff;
          bytes[3 + i * 2] = val & 0xff;
        }
        return bytes;
      }
      case 0x05: {
        // Write Single Coil
        const valueWord = (pdu[3]! << 8) | pdu[4]!;
        this.setCoil(address, valueWord === 0xff00);
        return pdu;
      }
      case 0x06: {
        // Write Single Register
        const val = (pdu[3]! << 8) | pdu[4]!;
        this.setHoldingRegister(address, val);
        return pdu;
      }
      case 0x0f: {
        // Write Multiple Coils
        const quantity = (pdu[3]! << 8) | pdu[4]!;
        const byteCount = pdu[5]!;
        const dataBytes = pdu.subarray(6, 6 + byteCount);
        for (let i = 0; i < quantity; i += 1) {
          const byteIndex = i >> 3;
          const bitIndex = i % 8;
          const isSet = ((dataBytes[byteIndex] ?? 0) & (1 << bitIndex)) !== 0;
          this.setCoil(address + i, isSet);
        }
        return pdu.subarray(0, 6);
      }
      case 0x10: {
        // Write Multiple Registers
        const quantity = (pdu[3]! << 8) | pdu[4]!;
        const byteCount = pdu[5]!;
        const dataBytes = pdu.subarray(6, 6 + byteCount);
        for (let i = 0; i < quantity; i += 1) {
          const high = dataBytes[i * 2] ?? 0;
          const low = dataBytes[i * 2 + 1] ?? 0;
          this.setHoldingRegister(address + i, (high << 8) | low);
        }
        return pdu.subarray(0, 6);
      }
      default: {
        // Exception 0x01: Illegal Function
        return new Uint8Array([0x80 + fc, 0x01]);
      }
    }
  }
}

export async function createSimulatedModbusServer(
  options: SimulatedModbusServerOptions = {},
): Promise<SimulatedModbusServer> {
  const server = new SimulatedModbusServer(options);
  await server.start();
  return server;
}
