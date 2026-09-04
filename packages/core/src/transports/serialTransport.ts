import { SerialPort } from 'serialport';
import { TransportError } from '../errors.js';
import { ByteQueue } from './byteQueue.js';
import type { Transport } from '../types.js';

export interface SerialPortOptions {
  path: string;
  baudRate?: number;
}

export interface SerialPortInfo {
  path: string;
  manufacturer?: string;
  serialNumber?: string;
  vendorId?: string;
  productId?: string;
}

export function serialPort(options: SerialPortOptions): Transport {
  return new NodeSerialTransport(options);
}

export async function listSerialPorts(): Promise<SerialPortInfo[]> {
  const ports = await SerialPort.list();
  return ports.map((port) => ({
    path: port.path,
    ...(port.manufacturer ? { manufacturer: port.manufacturer } : {}),
    ...(port.serialNumber ? { serialNumber: port.serialNumber } : {}),
    ...(port.vendorId ? { vendorId: port.vendorId } : {}),
    ...(port.productId ? { productId: port.productId } : {}),
  }));
}

class NodeSerialTransport implements Transport {
  readonly kind = 'serial';
  private port: SerialPort | undefined;
  private readonly inbound = new ByteQueue();

  constructor(private readonly options: SerialPortOptions) {}

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {
    const port = new SerialPort({
      path: this.options.path,
      baudRate: this.options.baudRate ?? 115200,
      autoOpen: false,
      rtscts: false,
    });

    port.on('data', (chunk: Buffer) => {
      this.inbound.push(new Uint8Array(chunk));
    });
    port.on('error', (error: Error) => {
      this.inbound.fail(
        new TransportError(`Serial port error: ${error.message}`, { cause: error }),
      );
    });
    port.on('close', () => {
      this.inbound.close();
    });

    await new Promise<void>((resolve, reject) => {
      port.open((error) => {
        if (error) {
          reject(
            new TransportError(
              `Failed to open serial port '${this.options.path}': ${error.message}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve();
      });
    });

    this.port = port;
  }

  async write(data: Uint8Array): Promise<void> {
    const port = this.port;
    if (!port || !port.isOpen) {
      throw new TransportError('Serial port is not open.');
    }
    await new Promise<void>((resolve, reject) => {
      port.write(Buffer.from(data), (error) => {
        if (error) {
          reject(new TransportError(`Serial write failed: ${error.message}`, { cause: error }));
          return;
        }
        port.drain((drainError) => {
          if (drainError) {
            reject(
              new TransportError(`Serial drain failed: ${drainError.message}`, {
                cause: drainError,
              }),
            );
            return;
          }
          resolve();
        });
      });
    });
  }

  async close(): Promise<void> {
    const port = this.port;
    this.port = undefined;
    this.inbound.close();
    if (!port || !port.isOpen) {
      return;
    }
    await new Promise<void>((resolve, reject) => {
      port.close((error) => {
        if (error) {
          reject(
            new TransportError(`Failed to close serial port: ${error.message}`, { cause: error }),
          );
          return;
        }
        resolve();
      });
    });
  }
}
