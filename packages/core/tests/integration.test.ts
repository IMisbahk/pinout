import { describe, expect, it } from 'vitest';
import {
  connect,
  simulatedEsp32,
  TimeoutError,
  TransportError,
  UnsupportedCapabilityError,
  ValidationError,
} from '@pinout/core';
import { ByteQueue } from '../src/transports/byteQueue.js';
import type { Transport } from '@pinout/core';

describe('sdk to simulated ESP32', () => {
  it('connects, writes GPIO, and reads it back', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      expect(device.info.firmware).toBe('esp32-bridge');
      expect(device.supports('gpio.write')).toBe(true);
      await device.gpio.write(2, true);
      await expect(device.gpio.read(2)).resolves.toBe(true);
      await device.gpio.write(2, false);
      await expect(device.gpio.read(2)).resolves.toBe(false);
    } finally {
      await device.close();
    }
  });

  it('exposes capability descriptors that can map to agent tools', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      const write = device.capabilities.find((capability) => capability.name === 'gpio.write');
      expect(write?.inputSchema.required).toEqual(['pin', 'value']);
      expect(write?.safety.physicalOutput).toBe(true);

      const tools = device.toAgentTools();
      expect(tools.map((tool) => tool.name)).toContain('gpio.write');
      expect(tools[0]?.annotations).toBeDefined();
    } finally {
      await device.close();
    }
  });

  it('rejects unsupported capabilities and invalid ESP32 pins before touching hardware', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await expect(device.invoke('motor.setSpeed', { rpm: 100 })).rejects.toBeInstanceOf(
        UnsupportedCapabilityError,
      );
      await expect(device.gpio.write(34, true)).rejects.toBeInstanceOf(ValidationError);
      await expect(device.gpio.write(6, true)).rejects.toBeInstanceOf(ValidationError);
      await expect(device.gpio.write(12, true)).rejects.toBeInstanceOf(ValidationError);
    } finally {
      await device.close();
    }
  });

  it('ignores serial boot garbage until the ready event', async () => {
    const device = await connect({ transport: new BootNoiseTransport() });
    try {
      await device.gpio.write(2, true);
      await expect(device.gpio.read(2)).resolves.toBe(true);
    } finally {
      await device.close();
    }
  });

  it('falls back to sys.hello when a native USB device was already running', async () => {
    const device = await connect({ transport: new ReadylessTransport(), timeoutMs: 500 });
    try {
      expect(device.info.firmware).toBe('esp32-bridge');
      await device.gpio.write(2, true);
      await expect(device.gpio.read(2)).resolves.toBe(true);
    } finally {
      await device.close();
    }
  });

  it('times out when the device never becomes ready', async () => {
    await expect(
      connect({ transport: new SilentTransport(), timeoutMs: 40 }),
    ).rejects.toBeInstanceOf(TimeoutError);
  });

  it('propagates a transport readable failure to in-flight requests', async () => {
    const transport = new FailOnDemandTransport();
    const device = await connect({ transport });
    try {
      transport.holdWrites = true;
      const write = device.gpio.write(2, true);
      transport.fail(new TransportError('Serial port error: cable unplugged'));
      await expect(write).rejects.toBeInstanceOf(TransportError);
    } finally {
      await device.close();
    }
  });
});

class FailOnDemandTransport implements Transport {
  readonly kind = 'fail-on-demand';
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

  fail(error: Error): void {
    this.inbound.fail(error);
  }

  async close(): Promise<void> {
    await this.inner.close();
    await this.pump?.catch(() => undefined);
    this.inbound.close();
  }

  private async forward(): Promise<void> {
    try {
      for await (const chunk of this.inner.readable) {
        this.inbound.push(chunk);
      }
      this.inbound.close();
    } catch (error) {
      this.inbound.fail(error instanceof Error ? error : new TransportError(String(error)));
    }
  }
}

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

class ReadylessTransport implements Transport {
  readonly kind = 'native-usb';
  private readonly inner = simulatedEsp32();
  private readonly inbound = new ByteQueue();
  private pump: Promise<void> | undefined;
  private droppedReady = false;

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

  async close(): Promise<void> {
    await this.inner.close();
    await this.pump?.catch(() => undefined);
    this.inbound.close();
  }

  private async forward(): Promise<void> {
    for await (const chunk of this.inner.readable) {
      if (!this.droppedReady && new TextDecoder().decode(chunk).includes('"event":"ready"')) {
        this.droppedReady = true;
        continue;
      }
      this.inbound.push(chunk);
    }
    this.inbound.close();
  }
}

class BootNoiseTransport implements Transport {
  readonly kind = 'boot-noise';
  private readonly inner = simulatedEsp32();
  private readonly inbound = new ByteQueue();
  private pump: Promise<void> | undefined;

  get readable(): AsyncIterable<Uint8Array> {
    return this.inbound;
  }

  async open(): Promise<void> {
    this.inbound.push(new TextEncoder().encode('ets Jun  8 2016 00:22:57\n'));
    this.inbound.push(new TextEncoder().encode('rst:0x1 (POWERON_RESET),boot:0x13\n'));
    await this.inner.open();
    this.pump = this.forward();
  }

  async write(data: Uint8Array): Promise<void> {
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
