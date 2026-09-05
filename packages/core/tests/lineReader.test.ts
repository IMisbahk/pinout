import { describe, expect, it } from 'vitest';
import { readLines } from '../src/lineReader.js';
import { encodeEvent, maxProtocolLineBytes } from '../src/protocol.js';
import { esp32BridgeInfo } from '../src/drivers/esp32/bridge.js';

describe('readLines', () => {
  it('yields a leftover unterminated line when the stream ends', async () => {
    async function* chunks(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode('{"v":1}\npartial');
    }

    const lines: string[] = [];
    for await (const line of readLines(chunks())) {
      lines.push(line);
    }
    expect(lines).toEqual(['{"v":1}', 'partial']);
  });

  it('drops an oversized frame and resumes at the next newline', async () => {
    async function* chunks(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode('x'.repeat(20));
      yield new TextEncoder().encode('x\nnext\n');
    }

    const lines: string[] = [];
    for await (const line of readLines(chunks(), 16)) lines.push(line);
    expect(lines).toEqual(['next']);
  });

  it('invokes onOversize callback when a line exceeds maxLineBytes', async () => {
    async function* chunks(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode('short\n');
      yield new TextEncoder().encode('this-is-too-long-frame\n');
      yield new TextEncoder().encode('after\n');
    }

    const oversized: number[] = [];
    const lines: string[] = [];
    for await (const line of readLines(chunks(), 10, {
      onOversize: (len) => oversized.push(len),
    })) {
      lines.push(line);
    }
    expect(lines).toEqual(['short', 'after']);
    expect(oversized.length).toBeGreaterThan(0);
    expect(oversized[0]).toBe('this-is-too-long-frame'.length);
  });

  it('parses full real simulator identity payload within maxProtocolLineBytes with headroom', async () => {
    const readyEvent = encodeEvent('ready', { ...esp32BridgeInfo });
    const payloadBytes = new TextEncoder().encode(readyEvent).length;

    // Must be strictly below 1024 bytes with substantial headroom (e.g. >= 200 bytes headroom)
    expect(payloadBytes).toBeLessThan(maxProtocolLineBytes);
    expect(maxProtocolLineBytes - payloadBytes).toBeGreaterThanOrEqual(200);

    async function* chunks(): AsyncIterable<Uint8Array> {
      yield new TextEncoder().encode(readyEvent);
    }

    const lines: string[] = [];
    for await (const line of readLines(chunks())) {
      lines.push(line);
    }
    expect(lines.length).toBe(1);
    const parsed = JSON.parse(lines[0]!);
    expect(parsed.event).toBe('ready');
    expect(parsed.payload.features).toContain('watchdog');
    expect(parsed.payload.capabilities.length).toBeGreaterThanOrEqual(20);
  });
});
