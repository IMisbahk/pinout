import { describe, expect, it } from 'vitest';
import { AbortedError, connect, simulatedEsp32, ValidationError } from '@pinout/core';
import { ByteQueue } from '../src/transports/byteQueue.js';
import type { Transport } from '@pinout/core';

describe('session', () => {
  it('isolates concurrent in-flight requests by id', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      const [writeResult, readResult] = await Promise.all([
        device.invoke('gpio.write', { pin: 2, value: true }),
        device.invoke('gpio.read', { pin: 13 }),
      ]);
      expect(writeResult).toEqual({ pin: 2, value: true });
      expect(readResult).toEqual({ pin: 13, value: false });
    } finally {
      await device.close();
    }
  });

  it('aborts connect when the signal is already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      connect({ transport: simulatedEsp32(), signal: controller.signal }),
    ).rejects.toBeInstanceOf(AbortedError);
  });

  it('aborts an in-flight request when the signal fires', async () => {
    const controller = new AbortController();
    const device = await connect({
      transport: new SlowReadyTransport(),
      signal: controller.signal,
    });
    try {
      const pending = device.invoke('gpio.write', { pin: 2, value: true });
      controller.abort();
      await expect(pending).rejects.toBeInstanceOf(AbortedError);
    } finally {
      await device.close().catch(() => undefined);
    }
  });

  it('rejects sys action payloads with unexpected fields before transport write', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await expect(device.invoke('sys.hello', { force: true })).rejects.toBeInstanceOf(
        ValidationError,
      );
      await expect(device.invoke('sys.ping', { echo: true })).rejects.toBeInstanceOf(
        ValidationError,
      );
    } finally {
      await device.close();
    }
  });
});

class SlowReadyTransport implements Transport {
  readonly kind = 'slow-ready';
  private readonly inner = simulatedEsp32();
  private readonly inbound = new ByteQueue();
  private pump: Promise<void> | undefined;

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {
    await this.inner.open();
    this.pump = this.forward();
  }

  async write(data: Uint8Array): Promise<void> {
    await new Promise((resolve) => {
      setTimeout(resolve, 30);
    });
    await this.inner.write(data);
  }

  async close(): Promise<void> {
    await this.inner.close();
    await this.pump?.catch(() => undefined);
    this.inbound.close();
  }

  private async forward(): Promise<void> {
    for await (const chunk of this.inner.readable) {
      this.inbound.push(chunk);
    }
    this.inbound.close();
  }
}
