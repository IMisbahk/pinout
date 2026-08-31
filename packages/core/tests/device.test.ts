import { describe, expect, it } from 'vitest';
import { connect, encodeEvent, simulatedEsp32 } from '@pinout/core';
import { encodeLine } from '../src/lineReader.js';
import { ByteQueue } from '../src/transports/byteQueue.js';
import type { Transport } from '@pinout/core';

describe('device events', () => {
  it('dispatches protocol events to listeners', async () => {
    const transport = new EventEmittingTransport();
    const device = await connect({ transport });
    try {
      const payloads: Array<Record<string, unknown>> = [];
      device.on('gpio.changed', (payload) => {
        payloads.push(payload);
      });

      transport.emit('gpio.changed', { pin: 2, value: true });
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      expect(payloads).toEqual([{ pin: 2, value: true }]);
    } finally {
      await device.close();
    }
  });

  it('fires once listeners only one time', async () => {
    const transport = new EventEmittingTransport();
    const device = await connect({ transport });
    try {
      let count = 0;
      device.once('sensor.sample', () => {
        count += 1;
      });

      transport.emit('sensor.sample', { value: 1 });
      transport.emit('sensor.sample', { value: 2 });
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });

      expect(count).toBe(1);
    } finally {
      await device.close();
    }
  });

  it('does not surface ready as a public event', async () => {
    const transport = simulatedEsp32();
    const device = await connect({ transport });
    try {
      let readyCount = 0;
      device.on('ready', () => {
        readyCount += 1;
      });
      expect(readyCount).toBe(0);
    } finally {
      await device.close();
    }
  });

  it('off removes a listener', async () => {
    const transport = new EventEmittingTransport();
    const device = await connect({ transport });
    try {
      const payloads: Array<Record<string, unknown>> = [];
      const handler = (payload: Record<string, unknown>): void => {
        payloads.push(payload);
      };
      device.on('gpio.changed', handler);
      device.off('gpio.changed', handler);
      transport.emit('gpio.changed', { pin: 2, value: true });
      await new Promise((resolve) => {
        setTimeout(resolve, 10);
      });
      expect(payloads).toEqual([]);
    } finally {
      await device.close();
    }
  });
});

class EventEmittingTransport implements Transport {
  readonly kind = 'event-emitting';
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
    await this.inner.write(data);
  }

  emit(event: string, payload: Record<string, unknown>): void {
    this.inbound.push(encodeLine(encodeEvent(event, payload)));
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
