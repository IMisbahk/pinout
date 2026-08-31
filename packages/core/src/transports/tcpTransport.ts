import net from 'node:net';
import { TransportError } from '../errors.js';
import { ByteQueue } from './byteQueue.js';
import type { Transport } from '../types.js';

export interface TcpTransportOptions {
  host: string;
  port: number;
}

export function tcpTransport(options: TcpTransportOptions): Transport {
  return new NodeTcpTransport(options);
}

class NodeTcpTransport implements Transport {
  readonly kind = 'tcp';
  private socket: net.Socket | undefined;
  private readonly inbound = new ByteQueue();

  constructor(private readonly options: TcpTransportOptions) {}

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {
    await new Promise<void>((resolve, reject) => {
      const socket = net.createConnection(
        { host: this.options.host, port: this.options.port },
        () => resolve(),
      );

      socket.on('data', (chunk: Buffer) => {
        this.inbound.push(new Uint8Array(chunk));
      });
      socket.on('error', (error: Error) => {
        this.inbound.fail(new TransportError(`TCP error: ${error.message}`, { cause: error }));
      });
      socket.on('close', () => {
        this.inbound.close();
      });

      socket.once('error', (error: Error) => {
        reject(
          new TransportError(
            `Failed to connect to ${this.options.host}:${this.options.port}: ${error.message}`,
            { cause: error },
          ),
        );
      });

      this.socket = socket;
    });
  }

  async write(data: Uint8Array): Promise<void> {
    const socket = this.socket;
    if (!socket || socket.destroyed) {
      throw new TransportError('TCP socket is not open.');
    }

    await new Promise<void>((resolve, reject) => {
      socket.write(Buffer.from(data), (error) => {
        if (error) {
          reject(new TransportError(`TCP write failed: ${error.message}`, { cause: error }));
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    this.inbound.close();
    this.socket?.destroy();
    this.socket = undefined;
  }
}
