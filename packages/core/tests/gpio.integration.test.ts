import { describe, expect, it } from 'vitest';
import { connect, simulatedEsp32, ValidationError } from '@pinout/core';
import { encodeRequest } from '../src/protocol.js';

describe('gpio family via simulated ESP32', () => {
  it('invokes gpio.mode, toggle, pwm, and analogRead', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await device.arm();
      expect(device.supports('gpio.mode')).toBe(true);
      expect(device.supports('gpio.toggle')).toBe(true);
      expect(device.supports('gpio.pwm')).toBe(true);
      expect(device.supports('gpio.analogRead')).toBe(true);

      await expect(device.invoke('gpio.mode', { pin: 4, mode: 'pullup' })).resolves.toMatchObject({
        pin: 4,
        mode: 'pullup',
      });

      await device.invoke('gpio.write', { pin: 2, value: false });
      await expect(device.invoke('gpio.toggle', { pin: 2 })).resolves.toMatchObject({
        pin: 2,
        value: true,
      });

      await expect(
        device.invoke('gpio.pwm', { pin: 2, duty: 0.25, frequency: 5000, channel: 0 }),
      ).resolves.toMatchObject({ pin: 2, duty: 0.25 });

      await expect(device.invoke('gpio.analogRead', { pin: 32 })).resolves.toMatchObject({
        pin: 32,
        value: expect.any(Number),
      });
      await expect(device.invoke('gpio.analogRead', { pin: 2 })).rejects.toBeInstanceOf(
        ValidationError,
      );
    } finally {
      await device.close();
    }
  });

  it('emits gpio.changed over the transport when a watched pin changes', async () => {
    const transport = simulatedEsp32();
    await transport.open();
    const lines: string[] = [];
    const pump = (async () => {
      for await (const chunk of transport.readable) {
        lines.push(new TextDecoder().decode(chunk));
      }
    })();

    await transport.write(new TextEncoder().encode(encodeRequest('arm1', 'sys.arm', {})));
    await transport.write(new TextEncoder().encode(encodeRequest('w1', 'gpio.watch', { pin: 2 })));
    await transport.write(
      new TextEncoder().encode(encodeRequest('w2', 'gpio.write', { pin: 2, value: true })),
    );
    await delay(20);
    await transport.close();
    await pump;

    const messages = lines.map((line) => JSON.parse(line));
    expect(messages.some((message) => message.event === 'gpio.changed')).toBe(true);
    const changed = messages.find((message) => message.event === 'gpio.changed');
    expect(changed?.payload).toEqual({ pin: 2, value: true });
  });

  it('reverts gpio.pulse after durationMs on the simulator', async () => {
    const transport = simulatedEsp32();
    await transport.open();
    const lines: string[] = [];
    const pump = (async () => {
      for await (const chunk of transport.readable) {
        lines.push(new TextDecoder().decode(chunk));
      }
    })();

    await transport.write(new TextEncoder().encode(encodeRequest('arm1', 'sys.arm', {})));
    await transport.write(new TextEncoder().encode(encodeRequest('p1', 'gpio.watch', { pin: 2 })));
    await transport.write(
      new TextEncoder().encode(
        encodeRequest('p2', 'gpio.pulse', { pin: 2, value: true, durationMs: 30 }),
      ),
    );
    await delay(60);
    await transport.close();
    await pump;

    const messages = lines.map((line) => JSON.parse(line));
    const changed = messages.filter((message) => message.event === 'gpio.changed');
    expect(changed.some((message) => message.payload?.value === true)).toBe(true);
    expect(changed.some((message) => message.payload?.value === false)).toBe(true);
  });

  it('cancels a pending pulse restoration when stopAll is requested', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await device.arm();
      await device.invoke('gpio.pulse', { pin: 2, value: true, durationMs: 40 });
      await device.invoke('gpio.stopAll', {});
      await delay(70);
      await expect(device.invoke('gpio.read', { pin: 2 })).resolves.toEqual({
        pin: 2,
        value: false,
      });
    } finally {
      await device.close();
    }
  });

  it('does not let a pulse restoration overwrite a newer explicit write', async () => {
    const device = await connect({ transport: simulatedEsp32() });
    try {
      await device.arm();
      await device.invoke('gpio.write', { pin: 2, value: true });
      await device.invoke('gpio.pulse', { pin: 2, value: false, durationMs: 30 });
      await device.invoke('gpio.write', { pin: 2, value: false });
      await new Promise((resolve) => setTimeout(resolve, 45));
      await expect(device.invoke('gpio.read', { pin: 2 })).resolves.toEqual({
        pin: 2,
        value: false,
      });
    } finally {
      await device.close();
    }
  });
});

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}
