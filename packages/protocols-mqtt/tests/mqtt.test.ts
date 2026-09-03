import { connect, type Socket } from 'node:net';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { MqttClient } from '../src/mqttClient.js';
import { MqttError } from '../src/errors.js';
import { decodeIngestion, encodePublishPayload, topicMatches } from '../src/mapping.js';
import { encodePublish, tryDecodePacket } from '../src/wire.js';
import { MqttBrokerSimulator } from './brokerSimulator.js';
import type { Transport } from '@pinout/core';

/** TCP transport for the loopback broker. */
function tcpTransport(port: number): Transport {
  let socket: Socket | undefined;
  const listeners: Array<(chunk: Uint8Array) => void> = [];
  return {
    kind: 'tcp',
    async open(): Promise<void> {
      socket = connect({ host: '127.0.0.1', port });
      await new Promise<void>((resolve, reject) => {
        socket!.once('connect', resolve);
        socket!.once('error', reject);
      });
      socket!.on('data', (chunk: Buffer) => {
        for (const listener of listeners) listener(chunk);
      });
    },
    async close(): Promise<void> {
      socket?.end();
      socket?.destroy();
    },
    async write(data: Uint8Array): Promise<void> {
      socket?.write(data);
    },
    get readable(): AsyncIterable<Uint8Array> {
      return {
        async *[Symbol.asyncIterator]() {
          const queue: Uint8Array[] = [];
          let notify: (() => void) | undefined;
          listeners.push((chunk) => {
            queue.push(chunk);
            notify?.();
          });
          for (;;) {
            if (queue.length === 0) {
              await new Promise<void>((resolve) => {
                notify = resolve;
              });
              continue;
            }
            yield queue.shift()!;
          }
        },
      };
    },
  };
}

describe('MQTT wire codec', () => {
  it('round-trips a QoS-0 publish through decode', () => {
    const bytes = encodePublish('plant/line1/temp', '21.5');
    const decoded = tryDecodePacket(bytes);
    expect(decoded).toBeDefined();
    expect(decoded!.packet.type).toBe('PUBLISH');
    expect(decoded!.packet.topic).toBe('plant/line1/temp');
    expect(decoded!.packet.payload!.toString()).toBe('21.5');
    expect(decoded!.packet.qos).toBe(0);
  });

  it('round-trips a QoS-1 publish with packet id', () => {
    const bytes = encodePublish('a/b', '{"v":1}', 7, 1);
    const decoded = tryDecodePacket(bytes)!;
    expect(decoded.packet.qos).toBe(1);
    expect(decoded.packet.packetId).toBe(7);
  });

  it('partial buffers decode to undefined (varint remaining length)', () => {
    const bytes = encodePublish('a/b', 'x'.repeat(200));
    expect(tryDecodePacket(bytes.subarray(0, 3))).toBeUndefined();
  });

  it('maps topics: exact, plus, and hash filters', () => {
    expect(topicMatches('a/b', 'a/b')).toBe(true);
    expect(topicMatches('a/+/c', 'a/b/c')).toBe(true);
    expect(topicMatches('a/#', 'a/b/c')).toBe(true);
    expect(topicMatches('a/+', 'a')).toBe(false);
    expect(topicMatches('a/b', 'a/c')).toBe(false);
  });
});

describe('MQTT mapping', () => {
  it('decodes numeric ingestion payloads', () => {
    const mapped = decodeIngestion(
      { topic: 't', as: { kind: 'state', field: 'temperature', unit: 'C' }, codec: 'number' },
      Buffer.from('21.5'),
    );
    expect(mapped.value).toBe(21.5);
  });

  it('rejects non-numeric payloads when the codec demands numbers', () => {
    expect(() =>
      decodeIngestion(
        { topic: 't', as: { kind: 'state', field: 'x' }, codec: 'number' },
        Buffer.from('hot'),
      ),
    ).toThrowError(MqttError);
  });

  it('extracts json fields for ingestion', () => {
    const mapped = decodeIngestion(
      {
        topic: 't',
        as: { kind: 'event', event: 'door.opened' },
        codec: 'json',
        jsonField: 'state',
      },
      Buffer.from('{"state":"open"}'),
    );
    expect(mapped.value).toBe('open');
  });

  it('interpolates publish payloads and refuses missing args', () => {
    expect(
      encodePublishPayload(
        { capability: 'pump.start', topic: 'pump/cmd', payload: '{"run":{value},"rate":{rate}}' },
        { value: true, rate: 2 },
      ),
    ).toBe('{"run":true,"rate":2}');
    expect(() =>
      encodePublishPayload({ capability: 'c', topic: 't', payload: '{speed}' }, {}),
    ).toThrowError(/requires argument 'speed'/);
  });
});

describe('MqttClient against the broker simulator', () => {
  let broker: MqttBrokerSimulator;

  beforeAll(async () => {
    broker = new MqttBrokerSimulator();
    await broker.start();
  });

  afterAll(async () => {
    await broker.stop();
  });

  it('connects, subscribes, publishes (both directions), and pings', async () => {
    const subscriber = new MqttClient({ transport: tcpTransport(broker.port), clientId: 'sub' });
    await subscriber.connect();

    const received: Array<{ topic: string; text: string }> = [];
    await subscriber.subscribe('plant/+/temp', (topic, payload) => {
      received.push({ topic, text: payload.toString() });
    });

    // Broker-side publish reaches the subscriber.
    broker.publish('plant/line1/temp', '21.5');
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(received).toEqual([{ topic: 'plant/line1/temp', text: '21.5' }]);

    // Client-side publish (QoS 1 waits for PUBACK) reaches another session.
    const publisher = new MqttClient({ transport: tcpTransport(broker.port), clientId: 'pub' });
    await publisher.connect();
    await publisher.subscribe('cmd/#', () => undefined);
    await publisher.publish('cmd/valve', 'open', 1);
    await publisher.ping();

    await subscriber.close();
    await publisher.close();
  });

  it('rejects when the transport ends before the broker answers', async () => {
    const silent = new MqttClient({
      transport: {
        kind: 'loopback',
        open: async () => undefined,
        close: async () => undefined,
        write: async () => undefined,
        readable: (async function* () {})(),
      },
      clientId: 'timeout',
      timeoutMs: 60,
    });
    await expect(silent.connect()).rejects.toMatchObject({ code: 'MQTT_CLOSED' });
  });
});
