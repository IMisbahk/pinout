import { randomUUID } from 'node:crypto';
import {
  DeviceError,
  DisconnectedError,
  ProtocolError,
  TimeoutError,
  TransportError,
} from './errors.js';
import { readLines } from './lineReader.js';
import { encodeRequest, parseDeviceInfo, parseLine } from './protocol.js';
import type { ProtocolEvent, ProtocolResponse } from './protocol.js';
import type { DeviceInfo, Transport } from './types.js';

interface PendingRequest {
  resolve: (response: ProtocolResponse) => void;
  reject: (error: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

export class Session {
  private readonly pending = new Map<string, PendingRequest>();
  private readonly readyWaiters: Array<(info: DeviceInfo) => void> = [];
  private readerTask: Promise<void> | undefined;
  private open = false;
  private closed = false;
  private deviceInfo: DeviceInfo | undefined;

  constructor(
    readonly transport: Transport,
    private readonly timeoutMs: number,
  ) {}

  async connect(): Promise<DeviceInfo> {
    if (this.open) {
      throw new TransportError('Session is already connected.');
    }

    await this.transport.open();
    this.open = true;
    const ready = this.waitForReady();
    this.readerTask = this.readLoop();

    try {
      await ready;
      this.deviceInfo = parseDeviceInfo(await this.request('sys.hello'));
      return this.deviceInfo;
    } catch (error) {
      await this.close().catch(() => undefined);
      throw error;
    }
  }

  async request(
    action: string,
    payload: Record<string, unknown> = {},
  ): Promise<Record<string, unknown>> {
    if (!this.open || this.closed) {
      throw new DisconnectedError();
    }

    const id = randomUUID();
    const response = await new Promise<ProtocolResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new TimeoutError(`Timed out waiting for '${action}' (${this.timeoutMs}ms).`));
      }, this.timeoutMs);

      this.pending.set(id, { resolve, reject, timer });
      this.transport
        .write(new TextEncoder().encode(encodeRequest(id, action, payload)))
        .catch((error: unknown) => {
          clearTimeout(timer);
          this.pending.delete(id);
          reject(
            new TransportError(
              error instanceof Error ? error.message : 'Failed to write to transport.',
              { cause: error },
            ),
          );
        });
    });

    if (!response.ok) {
      throw new DeviceError(response.error.code, response.error.message);
    }
    return response.result;
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;
    this.open = false;

    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(new DisconnectedError('Connection closed before the device responded.'));
      this.pending.delete(id);
    }

    await this.transport.close();
    await this.readerTask?.catch(() => undefined);
  }

  private waitForReady(): Promise<DeviceInfo> {
    if (this.deviceInfo) {
      return Promise.resolve(this.deviceInfo);
    }

    return new Promise<DeviceInfo>((resolve, reject) => {
      const waiter = (info: DeviceInfo): void => {
        clearTimeout(timer);
        resolve(info);
      };
      const timer = setTimeout(() => {
        const index = this.readyWaiters.indexOf(waiter);
        if (index >= 0) {
          this.readyWaiters.splice(index, 1);
        }
        reject(
          new TimeoutError(
            `Timed out waiting for the device ready event (${this.timeoutMs}ms). Is firmware running, and is the serial port correct?`,
          ),
        );
      }, this.timeoutMs);

      this.readyWaiters.push(waiter);
    });
  }

  private async readLoop(): Promise<void> {
    try {
      for await (const line of readLines(this.transport.readable)) {
        let message;
        try {
          message = parseLine(line);
        } catch (error) {
          this.rejectAll(error instanceof Error ? error : new ProtocolError(String(error)));
          return;
        }

        if (message === null) {
          continue;
        }

        if ('event' in message) {
          this.handleEvent(message);
          continue;
        }

        if ('ok' in message) {
          this.handleResponse(message);
        }
      }
    } catch (error) {
      this.rejectAll(
        error instanceof Error
          ? error
          : new TransportError('Transport readable stream failed.', { cause: error }),
      );
    } finally {
      this.rejectAll(new DisconnectedError('Transport closed.'));
    }
  }

  private handleEvent(event: ProtocolEvent): void {
    if (event.event !== 'ready') {
      return;
    }
    const info = parseDeviceInfo(event.payload);
    this.deviceInfo = info;
    while (this.readyWaiters.length > 0) {
      this.readyWaiters.shift()?.(info);
    }
  }

  private handleResponse(response: ProtocolResponse): void {
    const pending = this.pending.get(response.id);
    if (!pending) {
      return;
    }
    clearTimeout(pending.timer);
    this.pending.delete(response.id);
    pending.resolve(response);
  }

  private rejectAll(error: Error): void {
    for (const [id, pending] of this.pending) {
      clearTimeout(pending.timer);
      pending.reject(error);
      this.pending.delete(id);
    }
  }
}
