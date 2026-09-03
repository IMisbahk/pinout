import { once } from 'node:events';
import { afterEach, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import { PinoutRuntime } from '@pinout/core';
import { startDaemon, type RunningDaemon } from '../src/start.js';

let daemon: RunningDaemon | undefined;
afterEach(async () => {
  await daemon?.close();
});

describe('daemon WebSocket data plane', () => {
  it('authenticates upgrades and preserves binary bytes, metadata and sequence', async () => {
    daemon = await startDaemon(new PinoutRuntime(), { port: 0, token: 'stream-test' });
    const bus = daemon.context.streams;
    bus.register({ id: 'camera:rgb', deviceId: 'camera', name: 'rgb' });
    const url = `ws://127.0.0.1:${daemon.port}/v1/streams/camera%3Argb/frames`;
    const denied = new WebSocket(url);
    await expect(once(denied, 'open')).rejects.toThrow(/401/);
    const ws = new WebSocket(url, { headers: { authorization: 'Bearer stream-test' } });
    await once(ws, 'open');
    expect(bus.stats('camera:rgb')?.subscribers).toBe(1);
    const message = once(ws, 'message');
    bus.publish('camera:rgb', new Uint8Array([0, 255, 42]), { sourceAt: 123 });
    const [raw, isBinary] = (await message) as [Buffer, boolean];
    expect(isBinary).toBe(true);
    const headerLength = raw.readUInt32BE(0);
    const header = JSON.parse(raw.subarray(4, 4 + headerLength).toString());
    expect(header).toMatchObject({
      streamId: 'camera:rgb',
      sequence: 0,
      sourceAt: 123,
      encoding: 'binary',
    });
    expect([...raw.subarray(4 + headerLength)]).toEqual([0, 255, 42]);
    const closed = once(ws, 'close');
    bus.closeStream('camera:rgb');
    await closed;
    expect(bus.stats('camera:rgb')?.subscribers).toBe(0);
  });

  it('sends structured frames as JSON and releases subscribers on shutdown', async () => {
    daemon = await startDaemon(new PinoutRuntime(), { port: 0 });
    const bus = daemon.context.streams;
    bus.register({ id: 'sensor', deviceId: 'sensor', name: 'reading' });
    const ws = new WebSocket(`ws://127.0.0.1:${daemon.port}/v1/streams/sensor/frames`);
    await once(ws, 'open');
    const message = once(ws, 'message');
    bus.publish('sensor', { temperature: 21 });
    const [raw, binary] = (await message) as [Buffer, boolean];
    expect(binary).toBe(false);
    expect(JSON.parse(raw.toString()).data).toEqual({ temperature: 21 });
    const closed = once(ws, 'close');
    await daemon.close();
    daemon = undefined;
    await closed;
    expect(bus.stats('sensor')?.subscribers).toBe(0);
  });
});
