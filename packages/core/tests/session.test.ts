import { describe, expect, it } from 'vitest';
import {
  AbortedError,
  connect,
  DisconnectedError,
  simulatedEsp32,
  TimeoutError,
  ValidationError,
} from '@pinout/core';
import { ByteQueue } from '../src/transports/byteQueue.js';
import type { Transport } from '@pinout/core';

describe('session', () => {
  it('isolates concurrent in-flight requests by id', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await device.arm();
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
      await device.arm();
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

  it('times out an in-flight request when the device stops responding', async () => {
    const transport = new HoldWritesTransport();
    const device = await connect({ transport, timeoutMs: 40 });
    try {
      transport.holdWrites = true;
      await expect(device.gpio.write(2, true)).rejects.toBeInstanceOf(TimeoutError);
    } finally {
      await device.close();
    }
  });

  it('rejects in-flight requests when the connection closes', async () => {
    const transport = new HoldWritesTransport();
    const device = await connect({ transport });
    transport.holdWrites = true;
    const pending = device.gpio.write(2, true);
    await device.close();
    await expect(pending).rejects.toBeInstanceOf(DisconnectedError);
  });
});

class HoldWritesTransport implements Transport {
  readonly kind = 'hold-writes';
  holdWrites = false;
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
    if (this.holdWrites) {
      return;
    }
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
