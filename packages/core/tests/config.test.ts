import { describe, expect, it } from 'vitest';
import { connect, loadPinoutConfig, TimeoutError, ValidationError } from '@pinout/core';
import { ByteQueue } from '../src/transports/byteQueue.js';
import type { Transport } from '@pinout/core';

describe('loadPinoutConfig', () => {
  it('reads defaults when env vars are absent', () => {
    expect(loadPinoutConfig({})).toEqual({
      port: undefined,
      baudRate: 115200,
      timeoutMs: 5000,
      logLevel: 'info',
    });
  });

  it('parses configured env vars', () => {
    expect(
      loadPinoutConfig({
        PINOUT_PORT: ' /dev/ttyUSB0 ',
        PINOUT_BAUD: '921600',
        PINOUT_TIMEOUT: '1500',
        PINOUT_LOG_LEVEL: 'debug',
      }),
    ).toEqual({
      port: '/dev/ttyUSB0',
      baudRate: 921600,
      timeoutMs: 1500,
      logLevel: 'debug',
    });
  });

  it('rejects invalid numeric and log level values', () => {
    expect(() => loadPinoutConfig({ PINOUT_BAUD: 'fast' })).toThrow(ValidationError);
    expect(() => loadPinoutConfig({ PINOUT_LOG_LEVEL: 'trace' })).toThrow(ValidationError);
  });
});

describe('connect env defaults', () => {
  it('uses PINOUT_TIMEOUT when connect options omit timeoutMs', async () => {
    const previous = process.env.PINOUT_TIMEOUT;
    process.env.PINOUT_TIMEOUT = '40';
    try {
      await expect(connect({ transport: new SilentTransport() })).rejects.toBeInstanceOf(
        TimeoutError,
      );
    } finally {
      if (previous === undefined) {
        delete process.env.PINOUT_TIMEOUT;
      } else {
        process.env.PINOUT_TIMEOUT = previous;
      }
    }
  });
});

class SilentTransport implements Transport {
  readonly kind = 'silent';
  private readonly inbound = new ByteQueue();

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {}

  async write(_data: Uint8Array): Promise<void> {}

  async close(): Promise<void> {
    this.inbound.close();
  }
}
