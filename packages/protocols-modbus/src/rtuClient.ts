/**
 * Modbus RTU client over any Pinout Transport (serial, loopback, …).
 *
 * Validates slave address and CRC16 on every response; request/response
 * correlation is strict: one outstanding request at a time (the RTU bus is
 * half-duplex single-master).
 */
import type { Transport } from '@pinout/core';
import {
  ModbusError,
  crc16,
  decodeRtu,
  encodeReadRequest,
  encodeRtu,
  encodeWriteMultipleCoils,
  encodeWriteMultipleRegisters,
  encodeWriteSingle,
  type PduDecodeResult,
} from './wire.js';

export interface ModbusRtuOptions {
  transport: Transport;
  /** Slave (server) address 1..247. */
  slaveAddress: number;
  timeoutMs?: number;
}

export class ModbusRtuClient {
  private readonly transport: Transport;
  private readonly slaveAddress: number;
  private readonly timeoutMs: number;
  private inflight: {
    requestFunctionCode: number;
    resolve: (frame: Uint8Array) => void;
    reject: (error: Error) => void;
    timer: ReturnType<typeof setTimeout>;
  } | undefined;
  private started = false;
  private closed = false;

  constructor(options: ModbusRtuOptions) {
    if (!Number.isInteger(options.slaveAddress) || options.slaveAddress < 1 || options.slaveAddress > 247) {
      throw new ModbusError('MODBUS_INVALID_SLAVE', 'Slave address must be an integer in [1, 247].');
    }
    this.transport = options.transport;
    this.slaveAddress = options.slaveAddress;
    this.timeoutMs = options.timeoutMs ?? 5000;
  }

  async start(): Promise<void> {
    if (this.started) return;
    await this.transport.open();
    void this.consume();
    this.started = true;
  }

  async close(): Promise<void> {
    this.closed = true;
    this.failPending(new ModbusError('MODBUS_CONNECTION_CLOSED', 'RTU transport closed.'));
    await this.transport.close();
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
      throw new ModbusError('MODBUS_INVALID_VALUE', 'Register value must be an integer in [0, 65535].');
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

  private async readBits(functionCode: 0x01 | 0x02, startAddress: number, quantity: number): Promise<boolean[]> {
    const decoded = await this.request(functionCode, encodeReadRequest(functionCode, startAddress, quantity));
    return decoded.kind === 'bits' ? decoded.values : [];
  }

  private async readRegisters(functionCode: 0x03 | 0x04, startAddress: number, quantity: number): Promise<number[]> {
    const decoded = await this.request(functionCode, encodeReadRequest(functionCode, startAddress, quantity));
    return decoded.kind === 'registers' ? decoded.values : [];
  }

  private async request(functionCode: number, pdu: Uint8Array): Promise<PduDecodeResult> {
    if (this.closed) throw new ModbusError('MODBUS_NOT_CONNECTED', 'RTU client is closed.');
    if (this.inflight) {
      throw new ModbusError('MODBUS_INFLIGHT', 'An RTU request is already in flight; the bus is single-master half-duplex.');
    }

    const frame = encodeRtu(this.slaveAddress, pdu);
    const responsePromise = new Promise<Uint8Array>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.inflight = undefined;
        reject(new ModbusError('MODBUS_TIMEOUT', `No RTU response within ${this.timeoutMs}ms.`));
      }, this.timeoutMs);
      if (typeof timer === 'object' && timer !== null && 'unref' in timer) timer.unref();
      this.inflight = { requestFunctionCode: functionCode, resolve, reject, timer };
    });

    await this.transport.write(frame);
    const response = await responsePromise;
    return decodeRtu(response, functionCode, this.slaveAddress);
  }

  private async consume(): Promise<void> {
    try {
      for await (const chunk of this.transport.readable) {
        const waiter = this.inflight;
        if (!waiter) continue; // unsolicited bytes: drop
        this.inflight = undefined;
        clearTimeout(waiter.timer);
        waiter.resolve(chunk);
      }
    } catch (error) {
      this.failPending(error instanceof Error ? error : new Error(String(error)));
    }
  }

  private failPending(error: Error): void {
    const waiter = this.inflight;
    if (waiter) {
      clearTimeout(waiter.timer);
      this.inflight = undefined;
      waiter.reject(error);
    }
  }
}

export { crc16 };
