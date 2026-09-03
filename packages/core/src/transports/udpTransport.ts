import dgram from 'node:dgram';
import { TransportError } from '../errors.js';
import { ByteQueue } from './byteQueue.js';
import type { Transport } from '../types.js';

export interface UdpTransportOptions {
  /** Local port to bind; omit to bind an ephemeral port. */
  port?: number;
  /** Local bind address (default '0.0.0.0'). */
  host?: string;
  /** Remote port datagrams are sent to. */
  remotePort: number;
  /** Remote host datagrams are sent to. */
  remoteHost: string;
  /**
   * Timeout for the local bind in milliseconds. UDP is connectionless, so
   * there is no remote handshake to time out; this only bounds the bind.
   */
  timeoutMs?: number;
  /**
   * Automatically close the transport after this many milliseconds without a
   * send or receive. A per-datagram timeout is not possible in UDP because
   * datagrams are independent, so this is a simple idle timeout instead.
   */
  closeIfIdleFor?: number;
}

export function udpTransport(options: UdpTransportOptions): UdpTransport {
  return new UdpTransport(options);
}

/**
 * Connectionless UDP transport. There is NO reconnect logic: UDP has no
 * connection to re-establish, so a send that fails simply throws and the
 * caller decides what to do.
 */
export class UdpTransport implements Transport {
  readonly kind = 'udp';
  private socket: dgram.Socket | undefined;
  private readonly inbound = new ByteQueue();
  private idleTimer: NodeJS.Timeout | undefined;
  private closing = false;

  constructor(private readonly options: UdpTransportOptions) {}

  /** The locally bound port (resolved after open(); ephemeral binds included). */
  get localPort(): number | undefined {
    try {
      const address = this.socket?.address();
      if (address && typeof address === 'object') {
        return address.port;
      }
    } catch {
      // The socket is not bound yet.
    }
    return undefined;
  }

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {
    if (this.socket) {
      return;
    }

    const socket = dgram.createSocket('udp4');
    this.socket = socket;

    socket.on('message', (message: Buffer) => {
      this.touchIdleTimer();
      this.inbound.push(new Uint8Array(message));
    });
    socket.on('error', (error: Error) => {
      this.inbound.fail(new TransportError(`UDP error: ${error.message}`, { cause: error }));
    });
    socket.on('close', () => {
      this.inbound.close();
    });

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => {
        reject(
          new TransportError(
            `Timed out binding UDP socket on ${this.options.host ?? '0.0.0.0'}:${
              this.options.port ?? 0
            }.`,
          ),
        );
      }, this.options.timeoutMs ?? 5000);
      timeout.unref();

      const fail = (error: Error) => {
        clearTimeout(timeout);
        reject(
          new TransportError(
            `Failed to bind UDP socket on ${this.options.host ?? '0.0.0.0'}:${
              this.options.port ?? 0
            }: ${error.message}`,
            { cause: error },
          ),
        );
      };

      socket.once('error', fail);

      socket.bind({ port: this.options.port ?? 0, address: this.options.host ?? '0.0.0.0' }, () => {
        clearTimeout(timeout);
        resolve();
      });
    }).catch((error: unknown) => {
      // Release the socket so a failed open does not leak it.
      this.socket = undefined;
      try {
        socket.close(() => undefined);
      } catch {
        // The socket was never started; nothing to release.
      }
      throw error;
    });

    this.touchIdleTimer();
  }

  async write(data: Uint8Array): Promise<void> {
    const socket = this.socket;
    if (!socket) {
      throw new TransportError('UDP socket is not open.');
    }

    this.touchIdleTimer();
    await new Promise<void>((resolve, reject) => {
      socket.send(Buffer.from(data), this.options.remotePort, this.options.remoteHost, (error) => {
        if (error) {
          reject(
            new TransportError(
              `UDP send to ${this.options.remoteHost}:${this.options.remotePort} failed: ${error.message}`,
              { cause: error },
            ),
          );
          return;
        }
        resolve();
      });
    });
  }

  async close(): Promise<void> {
    if (this.closing) {
      return;
    }
    this.closing = true;
    this.clearIdleTimer();
    this.inbound.close();
    const socket = this.socket;
    this.socket = undefined;
    if (!socket) {
      return;
    }
    await new Promise<void>((resolve) => {
      socket.close(() => resolve());
    });
  }

  private touchIdleTimer(): void {
    const idleMs = this.options.closeIfIdleFor;
    if (!idleMs || this.closing) {
      return;
    }
    this.clearIdleTimer();
    const timer = setTimeout(() => {
      void this.close();
    }, idleMs);
    timer.unref();
    this.idleTimer = timer;
  }

  private clearIdleTimer(): void {
    if (this.idleTimer) {
      clearTimeout(this.idleTimer);
      this.idleTimer = undefined;
    }
  }
}
