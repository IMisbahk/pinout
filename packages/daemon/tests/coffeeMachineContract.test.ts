import { describe, expect, it } from 'vitest';
import { coffeeMachineModule, PinoutRuntime, simulatedEsp32, type Transport } from '@pinout/core';
import { startDaemon } from '../src/start.js';

class CountingTransport implements Transport {
  readonly kind = 'scripted-esp32';
  readonly actions: string[] = [];
  constructor(private readonly inner: Transport) {}
  get readable(): AsyncIterable<Uint8Array> {
    return this.inner.readable;
  }
  open(): Promise<void> {
    return this.inner.open();
  }
  close(): Promise<void> {
    return this.inner.close();
  }
  write(data: Uint8Array): Promise<void> {
    const frame = JSON.parse(new TextDecoder().decode(data)) as { action?: string };
    if (frame.action) this.actions.push(frame.action);
    return this.inner.write(data);
  }
}

describe('coffee-machine ESP32 contract', () => {
  it('uses the same semantic operation and dedupes without re-actuation', async () => {
    const transport = new CountingTransport(simulatedEsp32());
    const runtime = new PinoutRuntime();
    await runtime.registerModuleDevice(coffeeMachineModule, {
      id: 'coffee-esp32',
      transport,
      backendOptions: {
        heaterPin: 4,
        pumpPin: 5,
        waterLevelPin: 13,
        waterOkLevel: false,
        temperatureAdcPin: 32,
        temperatureScaleCPerCount: 0.01,
        brewDurationMs: 5,
      },
    });
    const daemon = await startDaemon(runtime, { port: 0, requireLeases: false });
    const url = `http://127.0.0.1:${daemon.port}/v1/devices/coffee-esp32/invoke`;
    const invoke = () =>
      fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          capability: 'brew.start',
          args: { shots: 1 },
          owner: 'contract',
          idempotencyKey: 'one-brew',
          waitFor: 'result',
        }),
      });
    try {
      expect((await invoke()).status).toBe(200);
      const writesAfterFirst = transport.actions.filter((action) => action === 'gpio.write').length;
      expect(writesAfterFirst).toBe(2);
      expect((await invoke()).status).toBe(200);
      expect(transport.actions.filter((action) => action === 'gpio.write')).toHaveLength(
        writesAfterFirst,
      );
    } finally {
      await daemon.close();
    }
  });
});
