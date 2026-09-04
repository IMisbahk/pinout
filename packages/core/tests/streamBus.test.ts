import { describe, expect, it } from 'vitest';
import { StreamBus } from '../src/stream/streamBus.js';

const tick = (ms = 1) => new Promise((resolve) => setTimeout(resolve, ms));

describe('StreamBus', () => {
  const rgb = {
    id: 'cam-01:rgb',
    deviceId: 'cam-01',
    name: 'RGB frames',
    codec: 'raw-rgb24',
    nominalRateHz: 30,
    layout: 'uint8[w*h*3]',
  };

  it('registers and lists streams', () => {
    const bus = new StreamBus();
    bus.register(rgb);
    expect(bus.list()).toHaveLength(1);
    expect(bus.list('cam-01')).toHaveLength(1);
    expect(bus.list('other')).toHaveLength(0);
    expect(bus.get('cam-01:rgb')?.codec).toBe('raw-rgb24');
    expect(() => bus.register(rgb)).toThrowError(/already registered/);
  });

  it('publishes frames with monotonic sequence numbers', () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const a = bus.publish('cam-01:rgb', new Uint8Array([1]));
    const b = bus.publish('cam-01:rgb', new Uint8Array([2]));
    expect(a?.sequence).toBe(0);
    expect(b?.sequence).toBe(1);
    expect(bus.snapshot('cam-01:rgb')?.data).toEqual(new Uint8Array([2]));
  });

  it('refuses publishing to unknown streams', () => {
    const bus = new StreamBus();
    expect(() => bus.publish('ghost:rgb', 1)).toThrowError(/unknown stream/i);
    expect(() => bus.subscribe('ghost:rgb')).toThrowError(/unknown stream/i);
  });

  it('fans frames out to multiple independent subscribers', async () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const a = bus.subscribe('cam-01:rgb');
    const b = bus.subscribe('cam-01:rgb', { bufferSize: 8 });

    bus.publish('cam-01:rgb', 1);
    bus.publish('cam-01:rgb', 2);
    bus.publish('cam-01:rgb', 3);

    expect((await a.sample(3)).map((f) => f.data)).toEqual([1, 2, 3]);
    expect((await b.sample(3)).map((f) => f.data)).toEqual([1, 2, 3]);
    a.close();
    b.close();
  });

  it('supports async iteration until the stream ends', async () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const handle = bus.subscribe('cam-01:rgb');

    const seen: number[] = [];
    const consuming = (async () => {
      for await (const frame of handle) {
        seen.push(frame.data as number);
        if (seen.length === 3) break;
      }
    })();

    bus.publish('cam-01:rgb', 10);
    bus.publish('cam-01:rgb', 11);
    bus.publish('cam-01:rgb', 12);
    await consuming;
    expect(seen).toEqual([10, 11, 12]);
  });

  it('applies drop-oldest backpressure: consumers see recent frames', async () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const handle = bus.subscribe('cam-01:rgb', { bufferSize: 2, policy: 'drop-oldest' });

    for (let i = 0; i < 10; i += 1) {
      bus.publish('cam-01:rgb', i);
    }
    const frames = await handle.sample(2);
    expect(frames.map((f) => f.data)).toEqual([8, 9]);
    expect(bus.stats('cam-01:rgb')?.droppedFrames).toBe(8);
    handle.close();
  });

  it('applies drop-latest backpressure: consumers keep the backlog', async () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const handle = bus.subscribe('cam-01:rgb', { bufferSize: 2, policy: 'drop-latest' });

    for (let i = 0; i < 10; i += 1) {
      bus.publish('cam-01:rgb', i);
    }
    // Buffer held [0, 1]; frames 2..9 were dropped at the source.
    const frames = await handle.sample(2);
    expect(frames.map((f) => f.data)).toEqual([0, 1]);
    expect(bus.stats('cam-01:rgb')?.droppedFrames).toBe(8);
    handle.close();
  });

  it('latest-only subscribers get only the freshest frame', async () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const handle = bus.subscribe('cam-01:rgb', { policy: 'latest-only' });

    bus.publish('cam-01:rgb', 1);
    bus.publish('cam-01:rgb', 2);
    bus.publish('cam-01:rgb', 3);
    await tick();
    const frames = await handle.sample(1);
    expect(frames[0]!.data).toBe(3);
    handle.close();
  });

  it('closing a stream ends all subscriber iterators', async () => {
    const bus = new StreamBus();
    bus.register(rgb);
    const a = bus.subscribe('cam-01:rgb');
    const b = bus.subscribe('cam-01:rgb');

    bus.publish('cam-01:rgb', 1);
    await a.sample(1);
    bus.closeStream('cam-01:rgb');

    await expect(a.ended).resolves.toBeUndefined();
    await expect(b.ended).resolves.toBeUndefined();
    const iter = b[Symbol.asyncIterator]();
    // b's buffered frame is still delivered before the stream end.
    const buffered = await iter.next();
    expect(buffered.done).toBe(false);
    const after = await iter.next();
    expect(after.done).toBe(true);
  });

  it('reports per-stream stats', () => {
    const bus = new StreamBus();
    bus.register(rgb);
    bus.publish('cam-01:rgb', 1);
    bus.publish('cam-01:rgb', 2);
    const stats = bus.stats('cam-01:rgb');
    expect(stats).toEqual({ publishedFrames: 2, droppedFrames: 0, subscribers: 0 });
    expect(bus.stats('nope')).toBeUndefined();
  });
});
