/**
 * Modbus TCP client.
 *
 * Matches responses to requests by MBAP transaction id. A transaction id
 * reuse while a matching response is still pending is a programming error
 * and is rejected. Timeouts apply per request; the socket survives a timeout
 * (responses to expired requests are discarded).
 */
import { Socket } from 'node:net';
import {
  ModbusError,
  decodePdu,
  encodeMbap,
  encodeReadRequest,
  encodeWriteMultipleCoils,
  encodeWriteMultipleRegisters,
  encodeWriteSingle,
  exceptionError,
  tryDecodeMbap,
  type ModbusFunctionCode,
  type PduDecodeResult,
} from './wire.js';

export interface ModbusTcpOptions {
  host: string;
  port: number;
  unitId?: number;
  timeoutMs?: number;
}

interface Pending {
  resolve: (pdu: Uint8Array) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class ModbusTcpClient {
  private socket: Socket | undefined;
  private buffer = Buffer.alloc(0);
  private nextTransactionId = 0;
  private readonly pending = new Map<number, Pending>();
  private readonly unitId: number;
  private readonly timeoutMs: number;
  private readonly host: string;
  private readonly port: number;
  private closed = false;

  constructor(options: ModbusTcpOptions) {
    this.host = options.host;
    this.port = options.port;
    this.unitId = options.unitId ?? 1;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async connect(): Promise<void> {
    if (this.socket) return;
    const socket = new Socket();
    socket.setNoDelay(true);
    await new Promise<void>((resolve, reject) => {
      const onError = (error: Error): void => {
        socket.destroy();
        reject(error);
      };
      socket.once('error', onError);
      socket.connect(this.port, this.host, () => {
        socket.off('error', onError);
        resolve();
      });
    });
    socket.on('data', (chunk: Buffer) => this.onData(chunk));
    socket.on('error', (error: Error) => this.failAll(error));
    socket.on('close', () =>
      this.failAll(new ModbusError('MODBUS_CONNECTION_CLOSED', 'TCP connection closed.')),
    );
    this.socket = socket;
  }

  async close(): Promise<void> {
    this.closed = true;
    const socket = this.socket;
    this.socket = undefined;
    this.failAll(new ModbusError('MODBUS_CONNECTION_CLOSED', 'Client closed.'));
    await new Promise<void>((resolve) => {
      if (!socket) return resolve();
      socket.end(() => {
        socket.destroy();
        resolve();
      });
    });
  }

  async readCoils(startAddress: number, quantity: number): Promise<boolean[]> {
    return this.readBits(0x01, startAddress, quantity);
  }

  async readDiscreteInputs(startAddress: number, quantity: number): Promise<boolean[]> {
    return this.readBits(0x02, startAddress, quantity);
  }

  async readHoldingRegisters(startAddress: number, quantity: number): Promise<number[]> {
    return this.readRegisters(0x03, startAddress, quantity);
  }

  async readInputRegisters(startAddress: number, quantity: number): Promise<number[]> {
    return this.readRegisters(0x04, startAddress, quantity);
  }

  async writeSingleCoil(address: number, value: boolean): Promise<void> {
    await this.request(0x05, encodeWriteSingle(0x05, address, value ? 0xff00 : 0x0000));
  }

  async writeSingleRegister(address: number, value: number): Promise<void> {
    if (!Number.isInteger(value) || value < 0 || value > 0xffff) {
      throw new ModbusError(
        'MODBUS_INVALID_VALUE',
        'Register value must be an integer in [0, 65535].',
      );
    }
    await this.request(0x06, encodeWriteSingle(0x06, address, value));
  }

  async writeMultipleCoils(address: number, values: boolean[]): Promise<void> {
    await this.request(0x0f, encodeWriteMultipleCoils(address, values));
  }

  async writeMultipleRegisters(address: number, values: number[]): Promise<void> {
    await this.request(0x10, encodeWriteMultipleRegisters(address, values));
  }

  // ---------------------------------------------------------------------------

  private async readBits(
    functionCode: 0x01 | 0x02,
    startAddress: number,
    quantity: number,
  ): Promise<boolean[]> {
    const decoded = await this.request(
      functionCode,
      encodeReadRequest(functionCode, startAddress, quantity),
    );
    return decoded.kind === 'bits' ? decoded.values : [];
  }

  private async readRegisters(
    functionCode: 0x03 | 0x04,
    startAddress: number,
    quantity: number,
  ): Promise<number[]> {
    const decoded = await this.request(
      functionCode,
      encodeReadRequest(functionCode, startAddress, quantity),
    );
    return decoded.kind === 'registers' ? decoded.values : [];
  }

  private async request(
    functionCode: ModbusFunctionCode,
    pdu: Uint8Array,
  ): Promise<PduDecodeResult> {
    if (this.closed || !this.socket) {
      throw new ModbusError('MODBUS_NOT_CONNECTED', 'TCP client is not connected.');
    }
    const transactionId = this.nextTransactionId;
    this.nextTransactionId = (this.nextTransactionId + 1) & 0xffff;

    const promise = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transactionId);
        reject(new ModbusError('MODBUS_TIMEOUT', `No Modbus response within ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref();
      this.pending.set(transactionId, { resolve, reject, timer });
    });

    const frame = encodeMbap(transactionId, this.unitId, pdu);
    await new Promise<void>((resolve, reject) => {
      this.socket!.write(frame, (error) => (error ? reject(error) : resolve()));
    });

    const response = await promise;
    const decoded = decodePdu(response, functionCode);
    if (decoded.kind === 'exception') {
      throw exceptionError(decoded.functionCode, decoded.exceptionCode);
    }
    return decoded;
  }

  private onData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    for (;;) {
      const parsed = tryDecodeMbap(this.buffer);
      if (!parsed) break;
      this.buffer = this.buffer.subarray(parsed.consumed);
      const waiter = this.pending.get(parsed.frame.transactionId);
      if (!waiter) continue; // late response to an expired request: discard
      this.pending.delete(parsed.frame.transactionId);
      clearTimeout(waiter.timer);
      waiter.resolve(parsed.frame.pdu);
    }
  }

  private failAll(error: Error): void {
    for (const [transactionId, waiter] of this.pending) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
      this.pending.delete(transactionId);
    }
  }
}

export type { PduDecodeResult };
