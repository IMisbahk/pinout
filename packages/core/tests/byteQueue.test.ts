import { describe, expect, it } from 'vitest';
import { ByteQueue } from '../src/transports/byteQueue.js';
import { TransportError } from '@pinout/core';

describe('ByteQueue', () => {
  it('yields pushed chunks then ends on close', async () => {
    const queue = new ByteQueue();
    const first = new Uint8Array([1, 2]);
    queue.push(first);
    queue.close();

    const received: Uint8Array[] = [];
    for await (const chunk of queue) {
      received.push(chunk);
    }
    expect(received).toEqual([first]);
  });

  it('surfaces fail() as a thrown transport error', async () => {
    const queue = new ByteQueue();
    const error = new TransportError('Serial port error: boom');
    const consumed = (async () => {
      for await (const _chunk of queue) {
        // wait until fail
      }
    })();
    queue.fail(error);
    await expect(consumed).rejects.toBe(error);
  });

  it('ignores push after close', async () => {
    const queue = new ByteQueue();
    queue.close();
    queue.push(new Uint8Array([1]));
    const received: Uint8Array[] = [];
    for await (const chunk of queue) {
      received.push(chunk);
    }
    expect(received).toEqual([]);
  });
});
