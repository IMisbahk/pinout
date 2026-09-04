/**
 * Data-plane stress tests (Wave-2 #11): high frame counts, slow consumers,
 * memory bounds. Raw camera/LiDAR/IMU frames must never flow through MCP —
 * the StreamBus is the boundary, and these tests prove it degrades by
 * DROPPING frames per its backpressure policy, never by growing unbounded.
 */
import { describe, expect, it } from 'vitest';
import { StreamBus } from '../src/stream/streamBus.js';

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

describe('stream bus stress', () => {
  const camera = { id: 'cam:rgb', deviceId: 'cam', name: 'rgb', codec: 'rgb24', nominalRateHz: 60 };

  it('sustains 10k frames without unbounded queue growth (drop-oldest consumer)', async () => {
    const bus = new StreamBus();
    bus.register(camera);
    const slowConsumer = bus.subscribe('cam:rgb', { bufferSize: 16, policy: 'drop-oldest' });

    for (let i = 0; i < 10_000; i += 1) {
      bus.publish('cam:rgb', new Uint8Array([i & 0xff]));
    }
    // The slow consumer kept only its bounded window: the LAST frames.
    const window = await slowConsumer.sample(16);
    expect(window).toHaveLength(16);
    expect(window[0]!.sequence).toBe(9984);
    expect(window[15]!.sequence).toBe(9999);

    const stats = bus.stats('cam:rgb')!;
    expect(stats.publishedFrames).toBe(10_000);
    expect(stats.droppedFrames).toBe(10_000 - 16);
    slowConsumer.close();
  });

  it('multiple consumers with different policies receive independent views', async () => {
    const bus = new StreamBus();
    bus.register(camera);
    const latest = bus.subscribe('cam:rgb', { policy: 'latest-only' });
    const backlog = bus.subscribe('cam:rgb', { bufferSize: 4, policy: 'drop-latest' });

    for (let i = 0; i < 100; i += 1) {
      bus.publish('cam:rgb', i);
    }
    await tick();
    const latestFrames = await latest.sample(1);
    expect(latestFrames[0]!.data).toBe(99);
    const backlogFrames = await backlog.sample(4);
    expect(backlogFrames.map((frame) => frame.data)).toEqual([0, 1, 2, 3]);
    latest.close();
    backlog.close();
  });

  it('large binary frames (raw camera payloads) ride the bus, not JSON control plane', async () => {
    const bus = new StreamBus();
    bus.register({ ...camera, layout: 'uint8[640*480*3]' });
    const frame = new Uint8Array(640 * 480 * 3);
    frame[0] = 0xde;
    frame[frame.length - 1] = 0xad;

    const consumer = bus.subscribe('cam:rgb', { bufferSize: 2 });
    bus.publish('cam:rgb', frame);
    const received = await consumer.sample(1);
    // The data plane preserves raw binary verbatim.
    expect(received[0]!.data).toBe(frame);
    expect((received[0]!.data as Uint8Array).length).toBe(921600);
    consumer.close();
  });

  it('snapshot always reflects the newest frame regardless of consumers', () => {
    const bus = new StreamBus();
    bus.register(camera);
    for (let i = 0; i < 5; i += 1) {
      bus.publish('cam:rgb', i);
    }
    expect(bus.snapshot('cam:rgb')?.data).toBe(4);
  });

  it('closing a stream mid-flight ends subscribers without leaking timers', async () => {
    const bus = new StreamBus();
    bus.register(camera);
    const consumer = bus.subscribe('cam:rgb');
    bus.publish('cam:rgb', 1);
    await consumer.sample(1);
    bus.closeStream('cam:rgb');
    await expect(consumer.ended).resolves.toBeUndefined();
    expect(bus.stats('cam:rgb')?.subscribers).toBe(0);
  });
});
