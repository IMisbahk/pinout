import { describe, expect, it } from 'vitest';
import type { Transport } from '@pinout/core';
import { MqttClient } from '../src/mqttClient.js';
import { decodeIngestion } from '../src/mapping.js';
import {
  encodeConnect,
  encodePublish,
  encodeSubscribe,
  encodePuback,
  encodeRemainingLength,
} from '../src/wire.js';

function scriptedTransport(reply: (data: Buffer) => Buffer | undefined) {
  const queue: Buffer[] = [];
  const writes: Buffer[] = [];
  let notify: (() => void) | undefined;
  let closed = false;
  const push = (data: Buffer) => {
    queue.push(data);
    notify?.();
  };
  const transport: Transport = {
    kind: 'loopback',
    open: async () => undefined,
    close: async () => {
      closed = true;
      notify?.();
    },
    write: async (bytes) => {
      const data = Buffer.from(bytes);
      writes.push(data);
      const response = reply(data);
      if (response) push(response);
    },
    readable: (async function* () {
      while (!closed) {
        if (queue.length) yield queue.shift()!;
        else
          await new Promise<void>((resolve) => {
            notify = resolve;
          });
      }
    })(),
  };
  return { transport, push, writes };
}

describe('MQTT interoperability regressions', () => {
  it('encodes authenticated CONNECT against independently specified bytes', () => {
    const bytes = encodeConnect({
      clientId: 'c',
      username: 'u',
      password: 'p',
      keepAliveSeconds: 300,
      cleanSession: false,
    });
    expect(bytes.toString('hex')).toBe('101300044d51545404c0012c000163000175000170');
    expect(() => encodeConnect({ clientId: 'c', password: 'p' })).toThrow(/username/);
  });

  it('preserves both bytes of identifiers on every QoS-1 flow', () => {
    expect(encodeSubscribe(513, 'a').toString('hex')).toBe('8206020100016100');
    expect(encodePublish('a', 'b', 513, 1).toString('hex')).toBe('3206000161020162');
    expect(encodePuback(513).toString('hex')).toBe('40020201');
    expect(() => encodePublish('a', 'b', 1, 2)).toThrow(/QoS/);
    expect(() => encodeRemainingLength(Infinity)).toThrow();
  });

  it('rejects broker connection refusals and closes the transport', async () => {
    const wire = scriptedTransport(() => Buffer.from([0x20, 2, 0, 5]));
    const client = new MqttClient({ transport: wire.transport, clientId: 'c' });
    await expect(client.connect()).rejects.toMatchObject({ code: 'MQTT_CONNECTION_REFUSED' });
    await expect(client.publish('a', 'b')).rejects.toMatchObject({ code: 'MQTT_CLOSED' });
  });

  it('rejects SUBACK failures instead of reporting a working subscription', async () => {
    const wire = scriptedTransport((data) =>
      data[0] === 0x10
        ? Buffer.from([0x20, 2, 0, 0])
        : Buffer.from([0x90, 3, data[2]!, data[3]!, 0x80]),
    );
    const client = new MqttClient({ transport: wire.transport, clientId: 'c' });
    await client.connect();
    try {
      await expect(client.subscribe('a', () => undefined)).rejects.toMatchObject({
        code: 'MQTT_SUBSCRIPTION_REFUSED',
      });
    } finally {
      await client.close();
    }
  });

  it('retains distinct subscription handlers and acknowledges inbound high packet IDs', async () => {
    const wire = scriptedTransport((data) => {
      if (data[0] === 0x10) return Buffer.from([0x20, 2, 0, 0]);
      if (data[0] === 0x82) return Buffer.from([0x90, 3, data[2]!, data[3]!, 0]);
      return undefined;
    });
    const client = new MqttClient({ transport: wire.transport, clientId: 'c' });
    await client.connect();
    const received: string[] = [];
    try {
      await client.subscribe('a', () => received.push('a'));
      await client.subscribe('b', () => received.push('b'));
      wire.push(Buffer.from('3206000161020162', 'hex'));
      await new Promise((resolve) => setTimeout(resolve, 10));
      expect(received).toEqual(['a']);
      expect(wire.writes.map((data) => data.toString('hex'))).toContain('40020201');
      wire.transport.write = async () => {
        throw new Error('write failed');
      };
      await expect(client.publish('a', 'b')).rejects.toThrow('write failed');
    } finally {
      await client.close();
    }
  });

  it('times out a live silent transport and releases it', async () => {
    const wire = scriptedTransport(() => undefined);
    const client = new MqttClient({ transport: wire.transport, clientId: 'c', timeoutMs: 10 });
    await expect(client.connect()).rejects.toMatchObject({ code: 'MQTT_TIMEOUT' });
  });

  it('rejects ambiguous numeric telemetry and missing JSON fields', () => {
    for (const payload of ['12oops', '', ' ']) {
      expect(() =>
        decodeIngestion(
          { topic: 'a', as: { kind: 'state', field: 'x' }, codec: 'number' },
          Buffer.from(payload),
        ),
      ).toThrow();
    }
    for (const payload of ['null', '{}']) {
      expect(() =>
        decodeIngestion(
          { topic: 'a', as: { kind: 'state', field: 'x' }, codec: 'json', jsonField: 'x' },
          Buffer.from(payload),
        ),
      ).toThrow(/field/);
    }
  });
});
